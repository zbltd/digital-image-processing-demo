/* 图像实验台 · 前端交互 */

const ALGO_LABEL = { he: "直方图均衡化", clahe: "CLAHE", gamma: "Gamma 校正＋拉伸" };
const ALGO_KEY = { he: "直方图均衡化", clahe: "CLAHE", gamma: "Gamma校正+拉伸" };
const METRICS = [
  ["mean", "平均亮度", "0—255"],
  ["std", "标准差", "CONTRAST"],
  ["entropy", "信息熵", "BIT"],
  ["grad", "平均梯度", "DETAIL"],
  ["psnr", "PSNR", "DB"],
  ["ssim", "SSIM", "STRUCTURE"],
];

const $ = (s) => document.querySelector(/^[#.\[]/.test(s) ? s : "#" + s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const STATIC = Boolean(window.STATIC_MODE);

const state = {
  hw2: null,
  uploaded: null,
  algo: "gamma",
  resultSrc: "",
  comparing: false,
  hw2Ready: false,
};

/* ------------------------- 页签 ------------------------- */
function activateTab(id) {
  $$(".rail-tab").forEach((b) => {
    const on = b.dataset.tab === id;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", String(on));
  });
  ["hw1", "hw2"].forEach((key) => {
    const panel = $("#" + key);
    const on = key === id;
    panel.hidden = !on;
    if (on) {
      panel.style.animation = "none";
      void panel.offsetWidth;
      panel.style.animation = "";
    }
  });
  if (id === "hw2" && !state.hw2Ready) initHw2();
  if (id === "hw2") requestAnimationFrame(() => drawHist($("dst")));
  history.replaceState(null, "", "#/" + id);
}

$$(".rail-tab").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  btn.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const tabs = $$(".rail-tab");
    const i = tabs.indexOf(btn);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    activateTab(next.dataset.tab);
  });
});

/* ------------------------- 状态与指标 ------------------------- */
function setStatus(text) {
  $("#status").textContent = text;
}

function fmt(key, value) {
  if (value == null) return "—";
  if (key === "psnr") return value >= 99 ? "—" : value.toFixed(2);
  if (key === "ssim") return value.toFixed(4);
  if (key === "entropy") return value.toFixed(2);
  if (key === "grad") return value.toFixed(2);
  return value.toFixed(1);
}

function renderStats(m) {
  $("#stats").innerHTML = METRICS.map(([key, name, unit]) => {
    const value = m ? m[key] : null;
    const text = fmt(key, value);
    return `<div class="metric">
      <span class="k">${name}</span>
      <span class="v">${text}</span>
      <span class="u">${unit}</span>
    </div>`;
  }).join("");
}

function updateOutputMeta(m) {
  if (m && m.psnr != null && m.ssim != null) {
    $("#dstMeta").textContent = `PSNR ${m.psnr.toFixed(2)} dB · SSIM ${m.ssim.toFixed(3)}`;
  } else {
    $("#dstMeta").textContent = "无参考原图 · 仅统计四项";
  }
}

/* ------------------------- 直方图 ------------------------- */
function drawHist(img) {
  const canvas = $("#hist");
  if (!canvas || !img || !img.complete || !img.naturalWidth) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10) return;

  const dpr = window.devicePixelRatio || 1;
  const w = rect.width;
  const h = rect.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const padL = 34;
  const padB = 20;
  const plotW = w - padL - 6;
  const plotH = h - padB - 6;
  const top = 6;

  ctx.strokeStyle = "rgba(233,229,220,.10)";
  ctx.lineWidth = 1;
  ctx.font = "9px SFMono-Regular, Consolas, monospace";
  ctx.fillStyle = "rgba(144,153,163,.75)";
  for (let i = 0; i <= 4; i++) {
    const y = top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padL, y + 0.5);
    ctx.lineTo(padL + plotW, y + 0.5);
    ctx.stroke();
  }

  const tmp = document.createElement("canvas");
  tmp.width = 256;
  tmp.height = 256;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(img, 0, 0, 256, 256);
  const data = tctx.getImageData(0, 0, 256, 256).data;
  const bins = new Array(64).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    bins[Math.min(63, Math.floor(g / 4))]++;
  }
  const max = Math.max(...bins) || 1;
  const bw = plotW / 64;

  bins.forEach((v, i) => {
    const bh = (v / max) * plotH;
    ctx.fillStyle = "rgba(216,160,92,.82)";
    ctx.fillRect(padL + i * bw + 0.5, top + plotH - bh, Math.max(1, bw - 1.4), bh);
  });

  ctx.fillStyle = "rgba(144,153,163,.72)";
  ctx.textAlign = "right";
  ["0", "64", "128", "192", "255"].forEach((label, i) => {
    const x = padL + (plotW / 4) * i;
    ctx.fillText(label, i === 0 ? padL + 10 : x, h - 4);
  });
  ctx.textAlign = "left";
  ctx.save();
  ctx.translate(9, top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("像素数", 0, 0);
  ctx.restore();
}

let histTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(histTimer);
  histTimer = setTimeout(() => drawHist($("dst")), 120);
});

/* ------------------------- 作业二 ------------------------- */
let initPromise = null;
function initHw2() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const metaURL = STATIC ? "data.json" : "/api/hw2";
      state.hw2 = await (await fetch(metaURL)).json();
      state.hw2Ready = true;
      showSample("gamma");
    } catch (err) {
      setStatus("读取示例数据失败：" + err.message);
      initPromise = null;
    }
  })();
  return initPromise;
}

function markAlgo(algo) {
  $$("[data-algo]").forEach((b) => {
    const on = b.dataset.algo === algo;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function showSample(algo) {
  state.algo = algo;
  state.uploaded = null;
  state.resultSrc = null;
  markAlgo(algo);
  $("#file").value = "";

  const data = state.hw2;
  $("#src").src = data.images.degraded;
  $("#srcCap").textContent = "降质图像";
  $("#srcMeta").textContent = "低照度 + 高斯噪声 · 512×512";
  $("#dst").src = data.images[algo];
  $("#dstCap").textContent = ALGO_LABEL[algo] + "结果";
  $("#spec2").textContent = "512 × 512 · RGB";

  resetCompare();
  const m = data.metrics[ALGO_KEY[algo]];
  state.resultSrc = data.images[algo];
  renderStats(m);
  updateOutputMeta(m);

  const g = data.params;
  const extra = algo === "gamma"
    ? `γ=${g.gamma} · 拉伸 [${g.lo}, ${g.hi}]`
    : "全图直方图映射";
  $("#metricDesc").textContent =
    `PSNR / SSIM 以原始清晰图像为参考。${ALGO_LABEL[algo]}：${extra}；载入自己的图像时只统计前四项。`;
  setStatus(`示例 · ${ALGO_LABEL[algo]} · 512×512`);
}

$$("[data-algo]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const algo = btn.dataset.algo;
    if (!state.uploaded) {
      showSample(algo);
    } else {
      await runUpload(algo);
    }
  });
});

$("file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    state.uploaded = ev.target.result;
    $("#src").src = state.uploaded;
    $("#srcCap").textContent = "载入图像";
    $("#srcMeta").textContent = file.name;
    $("#dstCap").textContent = ALGO_LABEL[state.algo] + "结果";
    await runUpload(state.algo);
  };
  reader.readAsDataURL(file);
});

async function runUpload(algo) {
  state.algo = algo;
  markAlgo(algo);
  setStatus("处理中 …");
  const t0 = performance.now();
  try {
    const data = STATIC
      ? await enhanceInBrowser(state.uploaded, algo)
      : await (await fetch("/api/enhance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: state.uploaded, algo }),
        })).json();
    if (data.error) throw new Error(data.error);

    resetCompare();
    state.resultSrc = data.image;
    $("#dst").src = data.image;
    $("#dstCap").textContent = ALGO_LABEL[algo] + "结果";
    $("#spec2").textContent = `${data.width} × ${data.height} · RGB`;
    renderStats(data.metrics);
    updateOutputMeta(null);

    const extra = data.params && data.params.gamma
      ? ` · γ=${data.params.gamma} · [${data.params.lo}, ${data.params.hi}]`
      : "";
    setStatus(`处理完成 · ${data.width}×${data.height} · ${Math.round(performance.now() - t0)} ms${extra}`);
    $("#metricDesc").textContent =
      "载入图像没有参考原图，因此不计算 PSNR / SSIM；其余指标反映亮度、对比度与细节。";
  } catch (err) {
    setStatus("处理失败：" + err.message);
  }
}

$("reset").addEventListener("click", () => {
  if (state.hw2) showSample("gamma");
});

/* 结果图加载完成后重绘直方图 */
$("dst").addEventListener("load", () => drawHist($("dst")));

/* 原图 / 增强结果对比 */
const peek = $("#peek");
function setCompare(on) {
  if (!state.resultSrc) return;
  state.comparing = on;
  peek.classList.toggle("is-on", on);
  peek.setAttribute("aria-pressed", String(on));
  peek.textContent = on ? "返回增强结果" : "对比原图";
  if (on) {
    $("#dst").src = $("#src").src;
    $("#dstCap").textContent = "降质图像（原图）";
  } else {
    $("#dst").src = state.resultSrc;
    $("#dstCap").textContent = ALGO_LABEL[state.algo] + "结果";
  }
}

function resetCompare() {
  state.comparing = false;
  peek.classList.remove("is-on");
  peek.setAttribute("aria-pressed", "false");
  peek.textContent = "对比原图";
}

peek.addEventListener("click", () => setCompare(!state.comparing));

/* 首屏 */
const initialTab = (location.hash || "").replace(/^#\/?/, "");
if (initialTab === "hw2") activateTab("hw2");

window.addEventListener("hashchange", () => {
  const tab = (location.hash || "").replace(/^#\/?/, "");
  if (tab === "hw1" || tab === "hw2") activateTab(tab);
});
