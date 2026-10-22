/* 浏览器端图像增强算法（用于纯静态部署，不依赖 Python 后端） */

const STATIC_TILES = 8;
const STATIC_CLIP = 2.5;

function clampByte(x) {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}

function loadStaticImage(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图像解码失败"));
    img.src = dataURL;
  });
}

function valueChannel(data, n) {
  const v = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    v[i] = Math.max(data[p], data[p + 1], data[p + 2]);
  }
  return v;
}

function applyLUT(data, v, lut) {
  for (let i = 0, p = 0; i < v.length; i++, p += 4) {
    const oldV = v[i];
    if (oldV === 0) continue;
    const k = lut[oldV] / oldV;
    data[p] = clampByte(Math.round(data[p] * k));
    data[p + 1] = clampByte(Math.round(data[p + 1] * k));
    data[p + 2] = clampByte(Math.round(data[p + 2] * k));
  }
}

/* 全局直方图均衡化 */
function buildEqualizeLUT(v) {
  const hist = new Float64Array(256);
  for (let i = 0; i < v.length; i++) hist[v[i]]++;
  const cdf = new Float64Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    cdf[i] = acc;
  }
  let cdfMin = 0;
  for (let i = 0; i < 256; i++) {
    if (cdf[i] > 0) { cdfMin = cdf[i]; break; }
  }
  const n = v.length;
  const denom = Math.max(1, n - cdfMin);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(((cdf[i] - cdfMin) / denom) * 255);
  }
  return lut;
}

/* CLAHE：分块直方图 + 裁剪 + 双线性插值 */
function buildClaheLUTs(v, w, h) {
  const tw = Math.ceil(w / STATIC_TILES);
  const th = Math.ceil(h / STATIC_TILES);
  const luts = new Array(STATIC_TILES * STATIC_TILES);
  for (let ty = 0; ty < STATIC_TILES; ty++) {
    for (let tx = 0; tx < STATIC_TILES; tx++) {
      const hist = new Float64Array(256);
      let count = 0;
      const y0 = ty * th;
      const y1 = Math.min((ty + 1) * th, h);
      const x0 = tx * tw;
      const x1 = Math.min((tx + 1) * tw, w);
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) {
          hist[v[row + x]]++;
          count++;
        }
      }
      const limit = (STATIC_CLIP * count) / 256;
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > limit) {
          excess += hist[i] - limit;
          hist[i] = limit;
        }
      }
      const add = excess / 256;
      const cdf = new Float64Array(256);
      let acc = 0;
      let denom = count;
      const lut = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        acc += hist[i] + add;
        cdf[i] = acc;
        lut[i] = Math.round((acc / denom) * 255);
      }
      luts[ty * STATIC_TILES + tx] = lut;
    }
  }
  return { luts, tw, th };
}

function applyClahe(data, v, w, h) {
  const { luts, tw, th } = buildClaheLUTs(v, w, h);
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / th - 0.5;
    let y0 = Math.floor(fy);
    y0 = y0 < 0 ? 0 : y0 > STATIC_TILES - 1 ? STATIC_TILES - 1 : y0;
    const y1 = Math.min(y0 + 1, STATIC_TILES - 1);
    const wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / tw - 0.5;
      let x0 = Math.floor(fx);
      x0 = x0 < 0 ? 0 : x0 > STATIC_TILES - 1 ? STATIC_TILES - 1 : x0;
      const x1 = Math.min(x0 + 1, STATIC_TILES - 1);
      const wx = Math.min(1, Math.max(0, fx - x0));
      const idx = y * w + x;
      const g = v[idx];
      const p00 = luts[y0 * STATIC_TILES + x0][g];
      const p01 = luts[y0 * STATIC_TILES + x1][g];
      const p10 = luts[y1 * STATIC_TILES + x0][g];
      const p11 = luts[y1 * STATIC_TILES + x1][g];
      const val = (1 - wy) * (1 - wx) * p00 + (1 - wy) * wx * p01 +
                  wy * (1 - wx) * p10 + wy * wx * p11;
      const k = v[idx] ? val / v[idx] : 0;
      const p = idx * 4;
      data[p] = clampByte(Math.round(data[p] * k));
      data[p + 1] = clampByte(Math.round(data[p + 1] * k));
      data[p + 2] = clampByte(Math.round(data[p + 2] * k));
    }
  }
}

/* Gamma 校正 + 1%/99% 对比度拉伸 */
function buildGammaLUT(v, target = 0.3) {
  const n = v.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += v[i];
  const mean = Math.max(sum / n / 255, 1e-3);
  let gamma = Math.log(target) / Math.log(mean);
  gamma = Math.min(3, Math.max(0.3, gamma));

  const v2 = new Float64Array(n);
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) {
    const val = 255 * Math.pow(v[i] / 255, gamma);
    v2[i] = val;
    hist[Math.round(val)]++;
  }
  const cdf = new Float64Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    cdf[i] = acc;
  }
  let lo = 0;
  let hi = 255;
  const lowCount = 0.01 * n;
  const highCount = 0.99 * n;
  for (let i = 0; i < 256; i++) {
    if (cdf[i] >= lowCount) { lo = i; break; }
  }
  for (let i = 0; i < 256; i++) {
    if (cdf[i] >= highCount) { hi = i; break; }
  }
  if (hi - lo < 1) { lo = 0; hi = 255; }
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const mapped = 255 * Math.pow(i / 255, gamma);
    const val = (mapped - lo) / (hi - lo);
    lut[i] = clampByte(Math.round(val * 255));
  }
  return { lut, gamma, lo: lo / 255, hi: hi / 255 };
}

function computeMetrics(data, w, h) {
  const n = w * h;
  const gray = new Float64Array(n);
  let sum = 0;
  const hist = new Float64Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    gray[i] = g;
    sum += g;
    hist[Math.round(g)]++;
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = gray[i] - mean;
    varSum += d * d;
  }
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (!hist[i]) continue;
    const p = hist[i] / n;
    entropy -= p * Math.log2(p);
  }
  let grad = 0;
  for (let y = 0; y < h - 1; y++) {
    const row = y * w;
    for (let x = 0; x < w - 1; x++) {
      const i = row + x;
      const dx = gray[i + 1] - gray[i];
      const dy = gray[i + w] - gray[i];
      grad += Math.sqrt((dx * dx + dy * dy) / 2);
    }
  }
  grad /= (w - 1) * (h - 1);
  return {
    mean,
    std: Math.sqrt(varSum / n),
    entropy,
    grad,
  };
}

/* 对外入口：输入 dataURL，输出与后端 /api/enhance 相同的结构 */
async function enhanceInBrowser(dataURL, algo) {
  const img = await loadStaticImage(dataURL);
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const n = w * h;
  const v = valueChannel(data, n);

  let params = {};
  if (algo === "he") {
    applyLUT(data, v, buildEqualizeLUT(v));
  } else if (algo === "clahe") {
    applyClahe(data, v, w, h);
  } else if (algo === "gamma") {
    const { lut, gamma, lo, hi } = buildGammaLUT(v, 0.3);
    applyLUT(data, v, lut);
    params = { gamma: Math.round(gamma * 100) / 100,
               lo: Math.round(lo * 1000) / 1000,
               hi: Math.round(hi * 1000) / 1000 };
  } else {
    throw new Error("未知算法");
  }

  ctx.putImageData(imageData, 0, 0);
  return {
    image: canvas.toDataURL("image/png"),
    width: w,
    height: h,
    params,
    metrics: computeMetrics(data, w, h),
  };
}
