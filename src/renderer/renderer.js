const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// 逻辑页面尺寸（A4 比例，单位 px 逻辑坐标）
const PAGE_W = 1240, PAGE_H = 1754;

// pdf.js worker（本地 vendor，离线可用）
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

let state = { notebooks: [], activeNotebook: null, settings: {} };
let nb = null;         // 当前 notebook
let pageIdx = 0;       // 当前页索引
let tool = "pen", color = "#1a1a1a", size = 3;
let zoom = 1, panX = 0, panY = 0;
let pens = [], activePen = 0;
const bgCache = new Map();   // pageId -> HTMLImageElement（页背景）

// 每页独立的 undo/redo 栈（存 strokes 快照的浅拷贝）
const undoStack = [], redoStack = [];

const paper = $("#paper"), ink = $("#ink");
const pctx = paper.getContext("2d"), ictx = ink.getContext("2d");
const wrap = $("#canvasWrap"), stage = $("#stage");

// ---- 初始化 ----
async function init() {
  state = await window.api.getState();
  nb = state.notebooks.find((n) => n.id === state.activeNotebook) || state.notebooks[0];
  tool = state.settings.lastTool || "pen";
  color = state.settings.lastColor || "#1a1a1a";
  size = state.settings.lastSize || 3;
  pens = state.settings.pens || [];
  activePen = state.settings.activePen || 0;

  setupCanvas();
  buildPalette();
  buildPens();
  bindToolbar();
  bindMenus();
  bindDrawing();
  bindKeys();
  selectTool(tool);
  $("#colorCustom").value = color;
  $("#sizeRange").value = size; $("#sizeVal").textContent = size;
  $("#paperSel").value = curPage().paper;
  $("#nbTitle").textContent = nb.title;

  fitToStage();
  renderAll();
}

function curPage() { return nb.pages[pageIdx]; }

// ---- 画布尺寸 & 缩放 ----
function setupCanvas() {
  for (const c of [paper, ink]) { c.width = PAGE_W; c.height = PAGE_H; }
}
function applyTransform() {
  wrap.style.width = PAGE_W + "px";
  wrap.style.height = PAGE_H + "px";
  wrap.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  wrap.style.transformOrigin = "center center";
  $("#zoomVal").textContent = Math.round(zoom * 100) + "%";
}
function fitToStage() {
  const pad = 40;
  const sw = stage.clientWidth - pad, sh = stage.clientHeight - pad;
  zoom = Math.min(sw / PAGE_W, sh / PAGE_H);
  panX = 0; panY = 0;
  applyTransform();
}

// 屏幕坐标 -> 页面逻辑坐标
function toLogical(e) {
  const r = ink.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / zoom,
    y: (e.clientY - r.top) / zoom,
    p: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
  };
}

// ---- 调色板 ----
function buildPalette() {
  const colors = ["#1a1a1a", "#e23b3b", "#2f7be6", "#1f9d55", "#f5a623", "#8e44ad"];
  $("#palette").innerHTML = colors
    .map((c) => `<span class="sw ${c === color ? "on" : ""}" style="background:${c}" data-c="${c}"></span>`)
    .join("");
  $$("#palette .sw").forEach((el) => el.addEventListener("click", () => setColor(el.dataset.c)));
}
function setColor(c) {
  color = c;
  $$("#palette .sw").forEach((el) => el.classList.toggle("on", el.dataset.c === c));
  $("#colorCustom").value = c;
  persistSettings();
}

// ---- 自定义笔盘 ----
function buildPens() {
  $("#pens").innerHTML = pens.map((p, i) => {
    const w = Math.max(2, Math.min(14, p.size));
    const hl = p.tool === "highlighter" ? "hl" : "";
    return `<button class="pen ${i === activePen ? "on" : ""} ${hl}" data-i="${i}" title="${p.tool === "highlighter" ? "荧光笔" : "钢笔"} · ${p.size}px">
      <span class="nib" style="background:${p.color}; height:${w}px"></span>
    </button>`;
  }).join("");
  $$("#pens .pen").forEach((el) => el.addEventListener("click", () => usePen(+el.dataset.i)));
}
function usePen(i) {
  const p = pens[i];
  if (!p) return;
  activePen = i;
  tool = p.tool; color = p.color; size = p.size;
  selectTool(tool);
  setColor(color);
  $("#sizeRange").value = size; $("#sizeVal").textContent = size;
  buildPens();
  window.api.updateSettings({ activePen });
}
function addPen() {
  pens.push({ tool: tool === "highlighter" ? "highlighter" : "pen", color, size });
  activePen = pens.length - 1;
  buildPens();
  window.api.updateSettings({ pens, activePen });
  toast("已存入笔盘");
}
function editPen() {
  if (!pens[activePen]) return;
  pens[activePen] = { tool: tool === "highlighter" ? "highlighter" : "pen", color, size };
  buildPens();
  window.api.updateSettings({ pens });
  toast("已更新此笔");
}
function delPen() {
  if (pens.length <= 1 || !pens[activePen]) return;
  pens.splice(activePen, 1);
  activePen = Math.max(0, activePen - 1);
  buildPens();
  window.api.updateSettings({ pens, activePen });
}

// ---- 工具栏 ----
function bindToolbar() {
  $$(".tool").forEach((b) => b.addEventListener("click", () => selectTool(b.dataset.tool)));
  $("#colorCustom").addEventListener("input", (e) => setColor(e.target.value));
  $("#sizeRange").addEventListener("input", (e) => {
    size = +e.target.value; $("#sizeVal").textContent = size; persistSettings();
  });
  $("#btnUndo").addEventListener("click", undo);
  $("#btnRedo").addEventListener("click", redo);
  $("#paperSel").addEventListener("change", (e) => {
    curPage().paper = e.target.value; save(); drawPaper(); renderThumbs();
  });
  $("#btnZoomIn").addEventListener("click", () => setZoom(zoom * 1.2));
  $("#btnZoomOut").addEventListener("click", () => setZoom(zoom / 1.2));
  $("#btnZoomFit").addEventListener("click", fitToStage);
  $("#btnMenu").addEventListener("click", () => {
    $("#sidebar").classList.toggle("hidden"); renderThumbs();
  });
  $("#btnAddPage").addEventListener("click", addPage);
  $("#btnAddPen").addEventListener("click", addPen);
  $("#btnEditPen").addEventListener("click", editPen);
  $("#btnDelPen").addEventListener("click", delPen);
  $("#nbTitle").addEventListener("click", renameNotebook);
  window.addEventListener("resize", applyTransform);
}
function selectTool(t) {
  tool = t;
  $$(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
  ink.style.cursor = t === "pan" ? "grab" : "crosshair";
  persistSettings();
}
function setZoom(z) { zoom = Math.max(0.15, Math.min(6, z)); applyTransform(); }
function persistSettings() {
  window.api.updateSettings({ lastTool: tool, lastColor: color, lastSize: size });
}

// ---- 导入 / 导出 下拉菜单 ----
function bindMenus() {
  const toggle = (id) => {
    const m = $(id);
    const open = m.classList.contains("open");
    $$(".dropdown").forEach((d) => d.classList.remove("open"));
    if (!open) m.classList.add("open");
  };
  $("#btnImport").addEventListener("click", (e) => { e.stopPropagation(); toggle("#importMenu"); });
  $("#btnExport").addEventListener("click", (e) => { e.stopPropagation(); toggle("#exportMenu"); });
  document.addEventListener("click", () => $$(".dropdown").forEach((d) => d.classList.remove("open")));

  $$("#importMenu button").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.imp;
    if (k === "image") importImage();
    if (k === "pdf") importPdf();
    if (k === "xopp") importXopp();
  }));
  $$("#exportMenu button").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.exp;
    if (k === "png") exportRaster("png");
    if (k === "jpg") exportRaster("jpg");
    if (k === "pdf") exportPdf();
    if (k === "xopp") exportXopp();
  }));
}

// ---- 绘制引擎 ----
let drawing = false, cur = null, panning = false, panStart = null;

function bindDrawing() {
  ink.addEventListener("pointerdown", (e) => {
    if (tool === "pan") { panning = true; panStart = { x: e.clientX - panX, y: e.clientY - panY }; ink.setPointerCapture(e.pointerId); return; }
    drawing = true;
    ink.setPointerCapture(e.pointerId);
    const pt = toLogical(e);
    cur = { tool, color, size, points: [pt] };
    if (tool === "eraser") eraseAt(pt);
  });
  ink.addEventListener("pointermove", (e) => {
    if (panning) { panX = e.clientX - panStart.x; panY = e.clientY - panStart.y; applyTransform(); return; }
    if (!drawing) return;
    const pt = toLogical(e);
    if (tool === "eraser") { cur.points.push(pt); eraseAt(pt); return; }
    cur.points.push(pt);
    drawStrokeLive(cur);
  });
  const end = () => {
    if (panning) { panning = false; return; }
    if (!drawing) return;
    drawing = false;
    if (tool === "eraser") { cur = null; return; }
    if (cur && cur.points.length) {
      pushUndo();
      curPage().strokes.push(cur);
      save(); renderInk(); renderThumbs();
    }
    cur = null;
  };
  ink.addEventListener("pointerup", end);
  ink.addEventListener("pointercancel", end);
  ink.addEventListener("pointerleave", () => { if (drawing && tool !== "eraser") end(); });

  // 滚轮缩放（Ctrl）/ 平移
  stage.addEventListener("wheel", (e) => {
    if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }
    else { panX -= e.deltaX; panY -= e.deltaY; applyTransform(); }
  }, { passive: false });
}

// 单条 stroke 画到某 context
function strokePath(ctx, s) {
  const pts = s.points;
  if (!pts.length) return;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (s.tool === "highlighter") {
    ctx.globalAlpha = 0.35; ctx.strokeStyle = s.color; ctx.lineWidth = s.size * 3;
  } else {
    ctx.globalAlpha = 1; ctx.strokeStyle = s.color; ctx.lineWidth = s.size;
  }
  if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = 1; return;
  }
  // 压感：钢笔按每段压力微调线宽，分段描边
  if (s.tool === "pen") {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.5, s.size * (0.5 + (a.p + b.p) / 2));
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  } else {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 实时把当前 stroke 叠加（避免整屏重绘）
function drawStrokeLive() {
  ictx.clearRect(0, 0, PAGE_W, PAGE_H);
  for (const s of curPage().strokes) strokePath(ictx, s);
  if (cur) strokePath(ictx, cur);
}

// 橡皮擦：命中笔画则删除
function eraseAt(pt) {
  const r = size * 2 + 6;
  const strokes = curPage().strokes;
  let hit = -1;
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokes[i].points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < r)) { hit = i; break; }
  }
  if (hit >= 0) { pushUndo(); strokes.splice(hit, 1); save(); renderInk(); renderThumbs(); }
}

// ---- 页背景（导入的 PDF / 图片）----
function getBg(page) {
  if (!page.bg) return null;
  if (bgCache.has(page.id)) return bgCache.get(page.id);
  const img = new Image();
  img.onload = () => { if (page === curPage()) drawPaper(); renderThumbs(); };
  img.src = page.bg;
  bgCache.set(page.id, img);
  return img;
}

// ---- 渲染 ----
function renderAll() { drawPaper(); renderInk(); renderThumbs(); }

// 把纸张纹理画到任意 context（导出/缩略图复用）
function paintPaper(cx, page) {
  cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, PAGE_W, PAGE_H);
  const img = getBg(page);
  if (img && img.complete && img.naturalWidth) {
    // 按比例居中铺满宽度
    const scale = PAGE_W / img.naturalWidth;
    const h = img.naturalHeight * scale;
    cx.drawImage(img, 0, 0, PAGE_W, h);
  }
  cx.strokeStyle = "#c9d6e5"; cx.lineWidth = 1;
  if (page.paper === "lined") {
    for (let y = 80; y < PAGE_H; y += 44) { cx.beginPath(); cx.moveTo(40, y); cx.lineTo(PAGE_W - 40, y); cx.stroke(); }
  } else if (page.paper === "grid") {
    for (let x = 40; x < PAGE_W; x += 40) { cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, PAGE_H); cx.stroke(); }
    for (let y = 40; y < PAGE_H; y += 40) { cx.beginPath(); cx.moveTo(0, y); cx.lineTo(PAGE_W, y); cx.stroke(); }
  }
}

function drawPaper() {
  pctx.clearRect(0, 0, PAGE_W, PAGE_H);
  paintPaper(pctx, curPage());
}
function renderInk() {
  ictx.clearRect(0, 0, PAGE_W, PAGE_H);
  for (const s of curPage().strokes) strokePath(ictx, s);
}

// 页面缩略图
function renderThumbs() {
  if ($("#sidebar").classList.contains("hidden")) return;
  const list = $("#pageList");
  list.innerHTML = nb.pages.map((p, i) =>
    `<div class="page-thumb ${i === pageIdx ? "active" : ""}" data-i="${i}">
       <canvas width="180" height="240"></canvas>
       <span class="num">${i + 1}</span>
       ${nb.pages.length > 1 ? '<button class="del" data-del="' + i + '">×</button>' : ""}
     </div>`).join("");
  $$("#pageList .page-thumb").forEach((el) => {
    const i = +el.dataset.i;
    const c = el.querySelector("canvas"), cx = c.getContext("2d");
    const sx = c.width / PAGE_W, sy = c.height / PAGE_H;
    cx.save(); cx.scale(sx, sy);
    paintPaper(cx, nb.pages[i]);
    for (const s of nb.pages[i].strokes) strokePath(cx, s);
    cx.restore();
    el.addEventListener("click", (e) => {
      if (e.target.dataset.del != null) return;
      gotoPage(i);
    });
    const del = el.querySelector("[data-del]");
    if (del) del.addEventListener("click", (e) => { e.stopPropagation(); deletePage(+del.dataset.del); });
  });
}

function gotoPage(i) {
  pageIdx = i; $("#paperSel").value = curPage().paper;
  undoStack.length = 0; redoStack.length = 0;
  renderAll();
}

// ---- 页面 / 笔记本操作 ----
async function addPage(opts = {}) {
  const id = await window.api.newId();
  nb.pages.splice(pageIdx + 1, 0, { id, paper: opts.paper || curPage().paper, bg: opts.bg || null, strokes: [] });
  pageIdx += 1;
  undoStack.length = 0; redoStack.length = 0;
  save(); renderAll();
  if (!opts.silent) toast("已新增页面");
  return curPage();
}
function deletePage(i) {
  if (nb.pages.length <= 1) return;
  if (!confirm(`删除第 ${i + 1} 页？此操作不可撤销。`)) return;
  bgCache.delete(nb.pages[i].id);
  nb.pages.splice(i, 1);
  if (pageIdx >= nb.pages.length) pageIdx = nb.pages.length - 1;
  save(); renderAll();
}
function renameNotebook() {
  const t = prompt("笔记本名称：", nb.title);
  if (t && t.trim()) { nb.title = t.trim(); $("#nbTitle").textContent = nb.title; save(); }
}

// ---- undo / redo ----
function snapshot() { return JSON.parse(JSON.stringify(curPage().strokes)); }
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  curPage().strokes = undoStack.pop();
  save(); renderInk(); renderThumbs();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  curPage().strokes = redoStack.pop();
  save(); renderInk(); renderThumbs();
}
function bindKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    if (e.key === "p") selectTool("pen");
    if (e.key === "h") selectTool("highlighter");
    if (e.key === "e") selectTool("eraser");
    if (/^[1-9]$/.test(e.key) && pens[+e.key - 1]) usePen(+e.key - 1);
  });
}

// ---- 持久化 ----
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.saveNotebooks(state.notebooks), 400);
}
function saveNow() { clearTimeout(saveTimer); return window.api.saveNotebooks(state.notebooks); }

// ---- busy 遮罩 ----
function busy(on, text) {
  const b = $("#busy");
  if (text) $("#busyText").textContent = text;
  b.classList.toggle("hidden", !on);
}

// ---- 合成整页（背景+纹理+墨迹）到离屏 canvas ----
function flattenPage(i) {
  const c = document.createElement("canvas");
  c.width = PAGE_W; c.height = PAGE_H;
  const cx = c.getContext("2d");
  paintPaper(cx, nb.pages[i]);
  for (const s of nb.pages[i].strokes) strokePath(cx, s);
  return c;
}

// ---- 导出：图片 ----
async function exportRaster(ext) {
  const c = flattenPage(pageIdx);
  const dataUrl = ext === "jpg" ? c.toDataURL("image/jpeg", 0.95) : c.toDataURL("image/png");
  const res = await window.api.exportImage({ dataUrl, ext, suggested: `${nb.title}-第${pageIdx + 1}页.${ext}` });
  if (res.ok) toast(`已导出 ${ext.toUpperCase()}`);
}

// ---- 导出：整本 PDF ----
async function exportPdf() {
  busy(true, "正在生成 PDF…");
  await new Promise((r) => setTimeout(r, 30));
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "px", format: [PAGE_W, PAGE_H] });
    for (let i = 0; i < nb.pages.length; i++) {
      if (i > 0) doc.addPage([PAGE_W, PAGE_H], "portrait");
      const img = flattenPage(i).toDataURL("image/jpeg", 0.92);
      doc.addImage(img, "JPEG", 0, 0, PAGE_W, PAGE_H);
    }
    const buffer = doc.output("arraybuffer");
    const res = await window.api.exportPdf({ buffer, suggested: `${nb.title}.pdf` });
    if (res.ok) toast("已导出 PDF");
  } finally { busy(false); }
}

// ---- 导入：图片（贴为当前页背景，若当前页已有笔迹则新建一页）----
async function importImage() {
  const res = await window.api.importImage();
  if (!res.ok) return;
  await placeBg(res.dataUrl);
  toast("图片已导入");
}
async function placeBg(dataUrl) {
  const target = curPage().strokes.length || curPage().bg
    ? await addPage({ bg: dataUrl, paper: "blank", silent: true })
    : curPage();
  target.bg = dataUrl;
  bgCache.delete(target.id);
  await saveNow(); renderAll();
}

// ---- 导入：PDF（pdf.js 逐页栅格化为页背景）----
async function importPdf() {
  const res = await window.api.importPdf();
  if (!res.ok) return;
  busy(true, "正在解析 PDF…");
  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(res.buffer) }).promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      busy(true, `导入 PDF 第 ${n}/${pdf.numPages} 页…`);
      const page = await pdf.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = PAGE_W / vp0.width;
      const vp = page.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const dataUrl = c.toDataURL("image/jpeg", 0.85);
      // 首页贴到空白当前页，其余新建
      const empty = curPage().strokes.length === 0 && !curPage().bg;
      const target = (n === 1 && empty) ? curPage() : await addPage({ bg: dataUrl, paper: "blank", silent: true });
      target.bg = dataUrl; target.paper = "blank";
      bgCache.delete(target.id);
    }
    nb.title = res.name || nb.title; $("#nbTitle").textContent = nb.title;
    await saveNow(); gotoPage(0);
    toast(`已导入 PDF（${pdf.numPages} 页）`);
  } catch (err) {
    console.error(err); alert("PDF 导入失败：" + err.message);
  } finally { busy(false); }
}

// ==== Xournal++ .xopp ====
// xopp 是 gzip 压缩的 XML。坐标单位与我们的逻辑坐标一致（1:1 px 映射）。
const XO_W = PAGE_W, XO_H = PAGE_H;

function toHexColor(c) {
  // #rrggbb -> #rrggbbff（xournal 用 8 位含 alpha）
  if (/^#[0-9a-f]{6}$/i.test(c)) return c + "ff";
  return c;
}
function fromHexColor(c) {
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7);
  return c;
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

async function exportXopp() {
  await saveNow();
  const out = [];
  out.push(`<?xml version="1.0" standalone="no"?>`);
  out.push(`<xournal creator="手写笔记 (Notes Plus clone)" fileversion="4">`);
  out.push(`<title>${esc(nb.title)}</title>`);
  for (const page of nb.pages) {
    out.push(`<page width="${XO_W}" height="${XO_H}">`);
    out.push(`<background type="solid" color="#ffffffff" style="${page.paper === "grid" ? "graph" : page.paper === "lined" ? "lined" : "plain"}"/>`);
    out.push(`<layer>`);
    for (const s of page.strokes) {
      const tool = s.tool === "highlighter" ? "highlighter" : "pen";
      const col = toHexColor(s.color);
      // 每点带宽度（压感）：width 首值为基准，其余为逐点宽度
      const widths = s.points.map((p, i) => {
        const w = s.tool === "highlighter" ? s.size * 3 : Math.max(0.5, s.size * (0.5 + (p.p ?? 0.5)));
        return +w.toFixed(2);
      });
      const coords = s.points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
      out.push(`<stroke tool="${tool}" color="${col}" width="${widths.join(" ")}">${coords}</stroke>`);
    }
    out.push(`</layer></page>`);
  }
  out.push(`</xournal>`);
  const res = await window.api.exportXopp({ xml: out.join("\n"), suggested: `${nb.title}.xopp` });
  if (res.ok) toast("已导出 .xopp");
}

async function importXopp() {
  const res = await window.api.importXopp();
  if (!res.ok) return;
  busy(true, "正在解析 .xopp…");
  try {
    const doc = new DOMParser().parseFromString(res.xml, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML 解析失败");
    const pageEls = [...doc.querySelectorAll("page")];
    if (!pageEls.length) throw new Error("文件中没有页面");
    const pages = [];
    for (const pe of pageEls) {
      const pw = parseFloat(pe.getAttribute("width")) || XO_W;
      const ph = parseFloat(pe.getAttribute("height")) || XO_H;
      const sx = XO_W / pw, sy = XO_H / ph;
      const bgStyle = pe.querySelector("background")?.getAttribute("style") || "plain";
      const paper = bgStyle === "graph" ? "grid" : bgStyle === "lined" || bgStyle === "ruled" ? "lined" : "blank";
      const strokes = [];
      for (const st of pe.querySelectorAll("layer > stroke, stroke")) {
        const nums = st.textContent.trim().split(/\s+/).map(Number).filter((n) => !isNaN(n));
        const pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i] * sx, y: nums[i + 1] * sy, p: 0.5 });
        if (!pts.length) continue;
        const tool = (st.getAttribute("tool") || "pen") === "highlighter" ? "highlighter" : "pen";
        const color = fromHexColor(st.getAttribute("color") || "#000000ff");
        const widths = (st.getAttribute("width") || "3").trim().split(/\s+/).map(Number);
        const base = widths[0] || 3;
        const size = tool === "highlighter" ? Math.max(1, Math.round(base / 3)) : Math.max(1, Math.round(base));
        strokes.push({ tool, color, size, points: pts });
      }
      const id = await window.api.newId();
      pages.push({ id, paper, bg: null, strokes });
    }
    nb.pages = pages;
    nb.title = res.name || nb.title; $("#nbTitle").textContent = nb.title;
    bgCache.clear();
    await saveNow(); gotoPage(0);
    toast(`已导入 .xopp（${pages.length} 页）`);
  } catch (err) {
    console.error(err); alert(".xopp 导入失败：" + err.message);
  } finally { busy(false); }
}

// ---- toast ----
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1300);
}

init();
