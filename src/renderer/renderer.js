const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// 逻辑页面尺寸（A4 比例，单位 px 逻辑坐标）
const PAGE_W = 1240, PAGE_H = 1754;

let state = { notebooks: [], activeNotebook: null, settings: {} };
let nb = null;         // 当前 notebook
let pageIdx = 0;       // 当前页索引
let tool = "pen", color = "#1a1a1a", size = 3;
let zoom = 1, panX = 0, panY = 0;

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

  setupCanvas();
  buildPalette();
  bindToolbar();
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
  $("#btnExportPng").addEventListener("click", exportPng);
  $("#btnExportPdf").addEventListener("click", exportPdf);
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

// ---- 渲染 ----
function renderAll() { drawPaper(); renderInk(); renderThumbs(); }

function drawPaper() {
  pctx.clearRect(0, 0, PAGE_W, PAGE_H);
  pctx.fillStyle = "#ffffff"; pctx.fillRect(0, 0, PAGE_W, PAGE_H);
  const paperType = curPage().paper;
  pctx.strokeStyle = "#c9d6e5"; pctx.lineWidth = 1;
  if (paperType === "lined") {
    for (let y = 80; y < PAGE_H; y += 44) { pctx.beginPath(); pctx.moveTo(40, y); pctx.lineTo(PAGE_W - 40, y); pctx.stroke(); }
  } else if (paperType === "grid") {
    for (let x = 40; x < PAGE_W; x += 40) { pctx.beginPath(); pctx.moveTo(x, 0); pctx.lineTo(x, PAGE_H); pctx.stroke(); }
    for (let y = 40; y < PAGE_H; y += 40) { pctx.beginPath(); pctx.moveTo(0, y); pctx.lineTo(PAGE_W, y); pctx.stroke(); }
  }
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
  // 画每个缩略图
  $$("#pageList .page-thumb").forEach((el) => {
    const i = +el.dataset.i;
    const c = el.querySelector("canvas"), cx = c.getContext("2d");
    const sx = c.width / PAGE_W, sy = c.height / PAGE_H;
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
    cx.save(); cx.scale(sx, sy);
    for (const s of nb.pages[i].strokes) strokePath(cx, s);
    cx.restore();
    el.addEventListener("click", (e) => {
      if (e.target.dataset.del != null) return;
      pageIdx = i; $("#paperSel").value = curPage().paper;
      undoStack.length = 0; redoStack.length = 0;
      renderAll();
    });
    const del = el.querySelector("[data-del]");
    if (del) del.addEventListener("click", (e) => { e.stopPropagation(); deletePage(+del.dataset.del); });
  });
}

// ---- 页面 / 笔记本操作 ----
async function addPage() {
  const id = await window.api.newId();
  nb.pages.splice(pageIdx + 1, 0, { id, paper: curPage().paper, strokes: [] });
  pageIdx += 1;
  undoStack.length = 0; redoStack.length = 0;
  save(); renderAll(); toast("已新增页面");
}
function deletePage(i) {
  if (nb.pages.length <= 1) return;
  if (!confirm(`删除第 ${i + 1} 页？此操作不可撤销。`)) return;
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    if (e.key === "p") selectTool("pen");
    if (e.key === "h") selectTool("highlighter");
    if (e.key === "e") selectTool("eraser");
  });
}

// ---- 持久化 ----
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.saveNotebooks(state.notebooks), 400);
}

// ---- 导出 ----
function flattenPage(i) {
  // 合成 paper+ink 到一张离屏 canvas
  const c = document.createElement("canvas");
  c.width = PAGE_W; c.height = PAGE_H;
  const cx = c.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, PAGE_W, PAGE_H);
  const saveIdx = pageIdx; pageIdx = i;
  // 复用绘制逻辑
  const pt = nb.pages[i].paper;
  cx.strokeStyle = "#c9d6e5"; cx.lineWidth = 1;
  if (pt === "lined") for (let y = 80; y < PAGE_H; y += 44) { cx.beginPath(); cx.moveTo(40, y); cx.lineTo(PAGE_W - 40, y); cx.stroke(); }
  if (pt === "grid") { for (let x = 40; x < PAGE_W; x += 40) { cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, PAGE_H); cx.stroke(); } for (let y = 40; y < PAGE_H; y += 40) { cx.beginPath(); cx.moveTo(0, y); cx.lineTo(PAGE_W, y); cx.stroke(); } }
  for (const s of nb.pages[i].strokes) strokePath(cx, s);
  pageIdx = saveIdx;
  return c;
}

async function exportPng() {
  const c = flattenPage(pageIdx);
  const dataUrl = c.toDataURL("image/png");
  const res = await window.api.exportPng({ dataUrl, suggested: `${nb.title}-第${pageIdx + 1}页.png` });
  if (res.ok) toast("已导出 PNG");
}

async function exportPdf() {
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
}

// ---- toast ----
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1300);
}

init();
