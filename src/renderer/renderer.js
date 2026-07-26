const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// A4 逻辑页面尺寸（210×297mm @ ~150dpi），所有纸张默认 A4
const PAGE_W = 1240, PAGE_H = 1754;

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

let state = { notebooks: [], activeNotebook: null, settings: {} };
let folders = [];       // 书架文件夹
let nb = null;          // 当前打开的 notebook
let pageIdx = 0;
let tool = "pen", color = "#1a1a1a", size = 3;
let zoom = 1, panX = 0, panY = 0;
let pens = [], activePen = 0;
let customTemplates = [];
let eraserMode = "stroke", eraserSize = 18;   // stroke=整笔 / pixel=像素
let dockTools = [];        // 笔盒自定义：[{t, on}]，顺序即显示顺序
let shots = [];            // 截图笔：本次会话的截图预览 [{id, dataUrl, w, h}]
const bgCache = new Map();

const undoStack = [], redoStack = [];

const paper = $("#paper"), ink = $("#ink"), overlay = $("#overlay");
const pctx = paper.getContext("2d"), ictx = ink.getContext("2d"), octx = overlay.getContext("2d");
const wrap = $("#canvasWrap"), stage = $("#stage"), textLayer = $("#textLayer");

const uid = () => window.api.newId();

// ═══════════ 初始化 ═══════════
async function init() {
  state = await window.api.getState();
  const s = state.settings;
  tool = s.lastTool || "pen"; color = s.lastColor || "#1a1a1a"; size = s.lastSize || 3;
  pens = s.pens || []; activePen = s.activePen || 0; customTemplates = s.customTemplates || [];
  eraserMode = s.eraserMode || "pixel"; eraserSize = s.eraserSize || 18;
  folders = s.folders || [];
  dockTools = normalizeDockTools(s.dockTools);
  // 迁移：只保留两种笔（笔 / 荧光笔）。检测到旧版多笔种预置则整体重置为新的两支
  const legacy = pens.some((p) => ["fountain", "marker", "ballpoint", "pencil"].includes(p.kind));
  const DEFAULT_PENS = [
    { kind: "pen",         tool: "pen",         color: "#1c1c1e", size: 3 },
    { kind: "highlighter", tool: "highlighter", color: "#ffd60a", size: 16 },
  ];
  if (!pens.length || legacy) {
    pens = DEFAULT_PENS.map((p) => ({ ...p }));
    activePen = 0;
    window.api.updateSettings({ pens, activePen: 0 });
  } else {
    pens.forEach((p) => { p.kind = (p.kind === "highlighter" || p.tool === "highlighter") ? "highlighter" : "pen"; });
  }
  if (activePen >= pens.length) activePen = 0;

  for (const c of [paper, ink, overlay]) { c.width = PAGE_W; c.height = PAGE_H; }
  bindShelf();
  bindTopbar();
  bindDock();
  bindMorePanel();
  bindMenus();
  bindDrawing();
  bindKeys();
  bindTemplateEditor();
  bindSelBar();
  bindWidgets();
  bindDockEditor();
  bindPenMultiEditor();
  bindShotTray();
  buildToolGrid();
  buildDockTools();
  buildPalette();

  renderShelf();
  showShelf();
}
function curPage() { return nb.pages[pageIdx]; }

// ═══════════ 屏幕切换 ═══════════
function showShelf() { $("#shelf").classList.remove("hidden"); $("#editor").classList.add("hidden"); renderShelf(); }
function showEditor() { $("#shelf").classList.add("hidden"); $("#editor").classList.remove("hidden"); }

// ═══════════ 书架 ═══════════
let curFolder = null;   // 当前所在文件夹 id（null=根）
function bindShelf() {
  $("#btnNewNotebook").addEventListener("click", newNotebook);
  $("#btnNewFolder").addEventListener("click", newFolder);
  $("#btnFolderBack").addEventListener("click", () => { curFolder = null; renderShelf(); });
}
function saveFolders() { return window.api.updateSettings({ folders }); }
function renderShelf() {
  const grid = $("#shelfGrid");
  const inFolder = curFolder != null;
  $("#btnFolderBack").classList.toggle("hidden", !inFolder);
  $("#btnNewFolder").classList.toggle("hidden", inFolder);   // 不做嵌套文件夹
  const f = inFolder ? folders.find((x) => x.id === curFolder) : null;
  $("#shelfTitle").textContent = f ? f.name : "我的笔记";

  const folderCards = inFolder ? "" : folders.map((fd) => {
    const count = state.notebooks.filter((n) => n.folderId === fd.id).length;
    return `<div class="folder-card" data-fid="${fd.id}">
      <div class="folder-ico" style="--fc:${fd.color || "#4c8dff"}">
        <svg viewBox="0 0 48 40"><path d="M2 8a4 4 0 0 1 4-4h11l5 5h20a4 4 0 0 1 4 4v23a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z"/></svg>
        <span class="folder-cnt">${count}</span>
      </div>
      <div class="nb-meta"><span class="nb-name">${escapeHtml(fd.name)}</span>
        <button class="nb-menu" data-fmenu="${fd.id}">⋯</button></div>
    </div>`;
  }).join("");

  const nbs = state.notebooks.filter((n) => (n.folderId || null) === curFolder);
  const nbCards = nbs.map((n) => `
    <div class="nb-card" data-id="${n.id}" draggable="true">
      <div class="nb-cover" style="background:${n.cover || "#4c8dff"}">
        <span class="spine"></span>
        <span class="glyph">✎</span>
        <span class="cnt">${n.pages.length} 页</span>
      </div>
      <div class="nb-meta">
        <span class="nb-name">${escapeHtml(n.title)}</span>
        <button class="nb-menu" data-menu="${n.id}">⋯</button>
      </div>
    </div>`).join("");

  grid.innerHTML = folderCards + nbCards ||
    `<div class="shelf-empty">这里还没有内容<br>点右上角新建笔记本${inFolder ? "" : "或文件夹"}</div>`;

  $$("#shelfGrid .nb-card").forEach((el) => {
    el.addEventListener("click", (e) => { if (e.target.dataset.menu != null) return; openNotebook(el.dataset.id); });
    bindNbDrag(el);
  });
  $$("#shelfGrid .nb-menu").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); notebookMenu(el.dataset.menu, el); }));
  $$("#shelfGrid .folder-card").forEach((el) => {
    el.addEventListener("click", (e) => { if (e.target.dataset.fmenu != null) return; curFolder = el.dataset.fid; renderShelf(); });
    bindFolderDrop(el);
  });
  $$("#shelfGrid [data-fmenu]").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); folderMenu(el.dataset.fmenu, el); }));
}
// 笔记本卡片拖拽（拖到文件夹上放入）
let dragNbId = null;
function bindNbDrag(el) {
  el.addEventListener("dragstart", (e) => { dragNbId = el.dataset.id; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
  el.addEventListener("dragend", () => { dragNbId = null; el.classList.remove("dragging"); $$(".folder-card").forEach((x) => x.classList.remove("drop-hot")); });
}
function bindFolderDrop(el) {
  el.addEventListener("dragover", (e) => { if (dragNbId) { e.preventDefault(); el.classList.add("drop-hot"); } });
  el.addEventListener("dragleave", () => el.classList.remove("drop-hot"));
  el.addEventListener("drop", async (e) => {
    e.preventDefault(); el.classList.remove("drop-hot");
    if (!dragNbId) return;
    const n = state.notebooks.find((x) => x.id === dragNbId);
    if (n) { n.folderId = el.dataset.fid; await window.api.saveNotebooks(state.notebooks); renderShelf(); toast("已移入文件夹"); }
  });
}
async function newFolder() {
  const name = await modalInput({ title: "新建文件夹", value: "新文件夹", placeholder: "文件夹名称" });
  if (name === null) return;
  const color = COVER_PALETTE[folders.length % COVER_PALETTE.length];
  folders.push({ id: await uid(), name: name.trim() || "新文件夹", color });
  await saveFolders(); renderShelf();
}
function folderMenu(id, anchor) {
  const fd = folders.find((x) => x.id === id); if (!fd) return;
  showCtxMenu(anchor, [
    { label: "打开", onClick: () => { curFolder = id; renderShelf(); } },
    { label: "重命名", onClick: async () => {
        const t = await modalInput({ title: "重命名文件夹", value: fd.name, placeholder: "文件夹名称" });
        if (t && t.trim()) { fd.name = t.trim(); await saveFolders(); renderShelf(); }
      } },
    { label: "改颜色", onClick: async () => {
        const c = await modalSwatch({ title: "文件夹颜色", colors: COVER_PALETTE, current: fd.color, custom: true });
        if (c) { fd.color = c; await saveFolders(); renderShelf(); }
      } },
    { label: "删除文件夹", danger: true, onClick: async () => {
        const inside = state.notebooks.filter((n) => n.folderId === id).length;
        const ok = await modalConfirm({ title: "删除文件夹", desc: inside ? `「${fd.name}」内的 ${inside} 本笔记将移回主书架。` : `删除「${fd.name}」？`, okText: "删除", danger: true });
        if (!ok) return;
        state.notebooks.forEach((n) => { if (n.folderId === id) n.folderId = null; });
        folders = folders.filter((x) => x.id !== id);
        await saveFolders(); await window.api.saveNotebooks(state.notebooks); renderShelf();
      } },
  ]);
}
async function moveNotebookToFolder(n) {
  if (n.folderId) { n.folderId = null; await window.api.saveNotebooks(state.notebooks); renderShelf(); toast("已移出文件夹"); return; }
  const pick = await modalList({ title: "移动到文件夹", items: folders.map((f) => ({ id: f.id, label: f.name, color: f.color })) });
  if (!pick) return;
  n.folderId = pick; await window.api.saveNotebooks(state.notebooks); renderShelf(); toast("已移动");
}
async function newNotebook() {
  const title = await modalInput({ title: "新建笔记本", desc: "给你的笔记本起个名字", value: "新笔记本", placeholder: "笔记本名称" });
  if (title === null) return;
  const cover = COVER_PALETTE[state.notebooks.length % COVER_PALETTE.length];
  const n = { id: await uid(), title: title.trim() || "新笔记本", cover, createdAt: Date.now(), folderId: curFolder,
    pages: [{ id: await uid(), template: "lined", bg: null, bookmark: null, strokes: [], texts: [] }] };
  state.notebooks.push(n);
  await window.api.saveNotebooks(state.notebooks);
  renderShelf();
  openNotebook(n.id);
}
function notebookMenu(id, anchor) {
  const n = state.notebooks.find((x) => x.id === id);
  if (!n) return;
  const moveItems = folders.length ? [{ label: n.folderId ? "移出文件夹" : "移动到文件夹…", onClick: () => moveNotebookToFolder(n) }] : [];
  showCtxMenu(anchor, [
    { label: "打开", onClick: () => openNotebook(id) },
    { label: "重命名", onClick: async () => {
        const t = await modalInput({ title: "重命名笔记本", value: n.title, placeholder: "笔记本名称" });
        if (t && t.trim()) { n.title = t.trim(); await window.api.saveNotebooks(state.notebooks); renderShelf(); }
      } },
    ...moveItems,
    { label: "换封面", onClick: async () => {
        const c = await modalSwatch({ title: "选择封面颜色", desc: "点色块或用＋自定义任意颜色", colors: COVER_PALETTE, current: n.cover, custom: true });
        if (c) { n.cover = c; await window.api.saveNotebooks(state.notebooks); renderShelf(); }
      } },
    { label: "删除", danger: true, onClick: async () => {
        const ok = await modalConfirm({ title: "删除笔记本", desc: `「${n.title}」将被删除，不可恢复。`, okText: "删除", danger: true });
        if (!ok) return;
        state.notebooks = state.notebooks.filter((x) => x.id !== id);
        await window.api.saveNotebooks(state.notebooks); renderShelf();
      } },
  ]);
}
async function openNotebook(id) {
  nb = state.notebooks.find((x) => x.id === id);
  if (!nb) return;
  await window.api.setActive(id);
  pageIdx = 0; bgCache.clear();
  undoStack.length = 0; redoStack.length = 0;
  $("#nbTitle").textContent = nb.title;
  buildPens(); buildTemplatePicker();
  selectTool(tool);
  $("#colorCustom").value = color; $("#sizeRange").value = size; $("#sizeVal").textContent = size;
  showEditor();
  fitToStage();
  renderAll();
  renderTexts();
}

// ═══════════ 缩放 / 变换 ═══════════
function applyTransform() {
  wrap.style.width = PAGE_W + "px"; wrap.style.height = PAGE_H + "px";
  wrap.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  wrap.style.transformOrigin = "center center";
  $("#zoomVal").textContent = Math.round(zoom * 100) + "%";
  if (sel) drawSelection();
}
function fitToStage() {
  const pad = 60;
  zoom = Math.min((stage.clientWidth - pad) / PAGE_W, (stage.clientHeight - pad) / PAGE_H);
  panX = 0; panY = 0; applyTransform();
}
function setZoom(z) { zoom = Math.max(0.15, Math.min(6, z)); applyTransform(); }
function toLogical(e) {
  const r = ink.getBoundingClientRect();
  return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom,
    p: e.pressure && e.pressure > 0 ? e.pressure : 0.5 };
}

// ═══════════ 调色板 & 笔盘 ═══════════
function buildPalette() {
  const colors = ["#1a1a1a", "#e2453b", "#2f7be6", "#1f9d55", "#f5a623", "#8e44ad", "#d63384", "#00897b"];
  $("#palette").innerHTML = colors.map((c) => `<span class="sw ${c === color ? "on" : ""}" style="background:${c}" data-c="${c}"></span>`).join("");
  $$("#palette .sw").forEach((el) => el.addEventListener("click", () => setColor(el.dataset.c)));
}
function setColor(c) {
  color = c;
  $$("#palette .sw").forEach((el) => el.classList.toggle("on", el.dataset.c === c));
  $("#colorCustom").value = c; persistSettings();
}
function darken(hex, f = 0.7) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
const PEN_KINDS = { pen: "笔", highlighter: "荧光笔" };
// 把每支笔画成真实的拟物笔（SVG）：笔杆=主色，笔尖随类型不同。仅两种：笔 / 荧光笔
function penSVG(p) {
  const kind = (p.kind === "highlighter" || p.tool === "highlighter") ? "highlighter" : "pen";
  const body = p.color, dark = darken(p.color, .62), tipDark = darken(p.color, .42);
  if (kind === "highlighter") {
    // 粗胖荧光笔：半透明宽笔尖 + 方肩笔身
    return `<svg viewBox="0 0 26 74" aria-label="荧光笔">
      <rect x="6" y="60" width="14" height="12" rx="2" fill="${body}" opacity=".55"/>
      <path d="M6 62 L20 62 L17 72 L9 72 Z" fill="${body}" opacity=".85"/>
      <rect x="5" y="10" width="16" height="52" rx="4" fill="${body}"/>
      <rect x="5" y="10" width="6" height="52" rx="4" fill="#ffffff" opacity=".28"/>
      <rect x="5" y="6" width="16" height="8" rx="3" fill="${dark}"/>
    </svg>`;
  }
  // 笔（普通实心笔）：实心笔尖 + 优雅笔身
  return `<svg viewBox="0 0 22 74" aria-label="笔">
    <path d="M11 73 L7 58 L15 58 Z" fill="${tipDark}"/>
    <rect x="10.2" y="61" width="1.6" height="12" fill="${darken(p.color,.25)}"/>
    <path d="M7 58 L15 58 L13.5 50 L8.5 50 Z" fill="#c8ccd2"/>
    <rect x="6.5" y="10" width="9" height="40" rx="4" fill="${body}"/>
    <rect x="6.5" y="10" width="3.4" height="40" rx="4" fill="#ffffff" opacity=".3"/>
    <rect x="6" y="5" width="10" height="8" rx="4" fill="${dark}"/>
    <rect x="14.2" y="16" width="2.2" height="22" rx="1" fill="#d1d1d6"/>
  </svg>`;
}
function penButton(p, i, on) {
  const hl = p.kind === "highlighter" ? "hl" : "";
  const label = `${PEN_KINDS[p.kind] || "笔"} · ${p.size}px`;
  return `<button class="pen ${on ? "on" : ""} ${hl}" data-i="${i}" title="${label}">${penSVG(p)}</button>`;
}
function buildPens() {
  const drawingActive = !["eraser", "lasso", "text", "shape", "pan", "shot", "cover", "laser"].includes(tool);
  $("#penRack").innerHTML = pens.map((p, i) => penButton(p, i, i === activePen && drawingActive)).join("");
  $$("#penRack .pen").forEach((el) => el.addEventListener("click", () => usePen(+el.dataset.i)));
  renderMyPens();
}
// 「更多」面板里的“我的笔”：同一批拟物笔 + 末尾一个＋新增
function renderMyPens() {
  const box = $("#myPens"); if (!box) return;
  box.innerHTML = pens.map((p, i) => penButton(p, i, i === activePen)).join("")
    + `<button id="btnAddPen" class="pen-add" title="新增笔">＋</button>`;
  $$("#myPens .pen").forEach((el) => el.addEventListener("click", () => { usePen(+el.dataset.i); openPenEdit(); }));
  const add = $("#myPens .pen-add"); if (add) add.addEventListener("click", addPen);
}
function openPenEdit() { const pe = $("#penEdit"); if (pe) pe.classList.remove("hidden"); }
// ═══════════ 统一工具注册表（更多面板九宫格 / 可自定义笔盒 共用） ═══════════
// kind: "select"=切换成绘制/交互工具（会高亮）；"action"=一次性动作（插图/加卡片/打开小工具）
const TOOL_REGISTRY = [
  { t: "pen",    name: "画笔",   kind: "select", svg: `<path d="M4 20l4-1 10-10-3-3L5 16z"/><path d="M14 6l3 3"/>` },
  { t: "highlighter", name: "荧光笔", kind: "select", svg: `<path d="M6 18l2 2 3-1 9-9-4-4-9 9z" /><path d="M6 18l3 1"/>` },
  { t: "eraser", name: "橡皮",   kind: "select", svg: `<path d="M8 20l-4-4a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L14 20z"/><path d="M8 20h11"/>` },
  { t: "lasso",  name: "套索",   kind: "select", svg: `<path d="M4 11c0-4 4-6 8-6s8 2 8 6-4 6-8 6c-1.5 0-2.8-.3-4-.7" stroke-dasharray="3 2.5"/><path d="M7 16c-1 .8-1 2.2 0 3"/>` },
  { t: "shot",   name: "截图笔", kind: "select", svg: `<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="9" y="9" width="6" height="6" rx="1"/>` },
  { t: "shape",  name: "形状",   kind: "select", svg: `<rect x="4" y="4" width="7" height="7" rx="1"/><circle cx="16.5" cy="7.5" r="3.5"/><path d="M4 20l4-6 4 6z"/>` },
  { t: "text",   name: "文字",   kind: "select", svg: `<path d="M5 6h14M12 6v13M9 19h6"/>` },
  { t: "cover",  name: "挖空笔", kind: "select", svg: `<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 12h16"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>` },
  { t: "laser",  name: "激光笔", kind: "select", svg: `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>` },
  { t: "pan",    name: "平移",   kind: "select", svg: `<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>` },
  { t: "insert", name: "图片",   kind: "action", svg: `<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-6 6"/>` },
  { t: "card",   name: "卡片",   kind: "action", svg: `<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M7 9h10M7 13h6"/>` },
  { t: "calc",   name: "计算器", kind: "action", svg: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h4"/>` },
  { t: "timer",  name: "计时器", kind: "action", svg: `<circle cx="12" cy="13" r="8"/><path d="M12 13V9M9 2h6M12 5V2"/>` },
];
const toolDef = (t) => TOOL_REGISTRY.find((d) => d.t === t);
// 默认笔盒：橡皮 / 套索 / 图片 / 截图笔（其余在「更多」里）
const DEFAULT_DOCK = ["eraser", "lasso", "insert", "shot"];
function normalizeDockTools(saved) {
  const valid = new Set(TOOL_REGISTRY.map((d) => d.t));
  if (Array.isArray(saved) && saved.length) return saved.filter((t) => valid.has(t));
  return DEFAULT_DOCK.slice();
}
// 中央派发：无论从 dock、九宫格还是快捷键触发，统一走这里
function invokeTool(t) {
  const d = toolDef(t); if (!d) return;
  if (d.kind === "action") {
    $("#morePanel").classList.add("hidden");
    if (t === "insert") importImage();
    else if (t === "card") addCard();
    else if (t === "calc") openCalc();
    else if (t === "timer") openTimer();
    return;
  }
  if (t === "pen" || t === "highlighter") usePenTool(t); else selectTool(t);
}
function buildToolGrid() {
  const g = $("#toolGrid"); if (!g) return;
  g.innerHTML = TOOL_REGISTRY.map((d) => `<button class="tool-cell" data-tool="${d.t}"><svg viewBox="0 0 24 24">${d.svg}</svg><span>${d.name}</span></button>`).join("");
  $$("#toolGrid .tool-cell").forEach((el) => el.addEventListener("click", () => { invokeTool(el.dataset.tool); syncToolGrid(); }));
  syncToolGrid();
}
function syncToolGrid() { $$("#toolGrid .tool-cell").forEach((el) => el.classList.toggle("active", el.dataset.tool === tool)); }
// 底部笔盒里的可自定义工具区
function buildDockTools() {
  const box = $("#dockTools"); if (!box) return;
  box.innerHTML = dockTools.map((t) => {
    const d = toolDef(t); if (!d) return "";
    const active = d.kind === "select" && tool === t ? " active" : "";
    return `<button class="dk tool${active}" data-tool="${t}" title="${d.name}"><svg viewBox="0 0 24 24">${d.svg}</svg></button>`;
  }).join("");
  $$("#dockTools .tool").forEach((el) => el.addEventListener("click", () => invokeTool(el.dataset.tool)));
}
function syncDockTools() { $$("#dockTools .tool").forEach((el) => el.classList.toggle("active", toolDef(el.dataset.tool)?.kind === "select" && el.dataset.tool === tool)); }
let penKind = "pen";
function usePen(i) {
  const p = pens[i]; if (!p) return;
  activePen = i; tool = p.tool; color = p.color; size = p.size; penKind = (p.kind === "highlighter" || p.tool === "highlighter") ? "highlighter" : "pen";
  selectTool(tool);
  setColor(color);
  $("#sizeRange").value = size; $("#sizeVal").textContent = size;
  syncPenKindUI();
  buildPens();
  window.api.updateSettings({ activePen });
}
function penFromCurrent() {
  return { kind: penKind, tool: penKind === "highlighter" ? "highlighter" : "pen", color, size };
}
function addPen() {
  pens.push(penFromCurrent());
  activePen = pens.length - 1; buildPens();
  window.api.updateSettings({ pens, activePen }); toast("已存入笔盘");
}
function editPen() {
  if (!pens[activePen]) return;
  pens[activePen] = penFromCurrent();
  tool = pens[activePen].tool; buildPens(); window.api.updateSettings({ pens }); toast("已更新此笔");
}
function syncPenKindUI() {
  $$("#penKind .kind").forEach((el) => el.classList.toggle("on", el.dataset.kind === penKind));
}
function delPen() {
  if (pens.length <= 1) return;
  pens.splice(activePen, 1); activePen = Math.max(0, activePen - 1);
  buildPens(); window.api.updateSettings({ pens, activePen });
}

// ═══════════ 顶栏 / Dock / 弹层 ═══════════
function on(sel, evt, fn) { const el = $(sel); if (el) el.addEventListener(evt, fn); }
function bindTopbar() {
  on("#btnBack", "click", () => { closeText(); showShelf(); });
  on("#btnPages", "click", () => toggleDrawer("pages"));
  on("#btnBookmarks", "click", () => toggleDrawer("bookmarks"));
  on("#btnBookmarkPage", "click", toggleBookmark);
  on("#btnAddPage", "click", () => addPage());
  on("#btnZoomFit", "click", fitToStage);
  on("#btnLocate", "click", fitToStage);
  on("#nbTitle", "click", renameCurrent);
}
function bindDock() {
  on("#btnUndo", "click", undo);
  on("#btnRedo", "click", redo);
  on("#btnAddPen", "click", addPen);
  on("#btnMore", "click", (e) => { e.stopPropagation(); $("#morePanel").classList.toggle("hidden"); syncToolGrid(); });
}
function bindMorePanel() {
  $("#colorCustom").addEventListener("input", (e) => setColor(e.target.value));
  $("#sizeRange").addEventListener("input", (e) => { size = +e.target.value; $("#sizeVal").textContent = size; persistSettings(); });
  $("#btnEditPen").addEventListener("click", editPen);
  $("#btnDelPen").addEventListener("click", delPen);
  $("#btnNewTpl").addEventListener("click", openTemplateEditor);
  // 笔类型切换
  $$("#penKind .kind").forEach((el) => el.addEventListener("click", () => {
    penKind = el.dataset.kind;
    if (penKind === "highlighter") { tool = "highlighter"; } else { tool = "pen"; }
    syncPenKindUI(); selectTool(tool);
  }));
  // 橡皮模式 / 大小
  $$("#eraserMode .seg-btn").forEach((el) => el.addEventListener("click", () => {
    eraserMode = el.dataset.mode;
    $$("#eraserMode .seg-btn").forEach((b) => b.classList.toggle("on", b === el));
    window.api.updateSettings({ eraserMode });
  }));
  $("#eraserSize").addEventListener("input", (e) => {
    eraserSize = +e.target.value; $("#eraserVal").textContent = eraserSize;
    window.api.updateSettings({ eraserSize });
  });
  document.addEventListener("click", (e) => {
    if (!$("#morePanel").contains(e.target) && e.target.id !== "btnMore") $("#morePanel").classList.add("hidden");
  });
}
function selectTool(t) {
  tool = t;
  clearSelection();
  syncDockTools();
  buildPens();
  // 更多面板：橡皮工具时显示橡皮设置、隐藏笔编辑
  const es = $("#eraserSec"), pe = $("#penEdit");
  if (es) es.classList.toggle("hidden", t !== "eraser");
  if (pe && t === "eraser") pe.classList.add("hidden");
  if (t === "eraser") {
    $("#eraserSize").value = eraserSize; $("#eraserVal").textContent = eraserSize;
    $$("#eraserMode .seg-btn").forEach((b) => b.classList.toggle("on", b.dataset.mode === eraserMode));
  }
  textLayer.style.pointerEvents = t === "text" ? "auto" : "none";
  // 图片对象仅在套索工具下可选中/拖动/缩放，其余工具可在图片上正常书写
  const il = $("#imageLayer"); if (il) il.classList.toggle("interactive", t === "lasso");
  ink.style.cursor = t === "pan" ? "grab" : t === "text" ? "text" : "crosshair";
  syncToolGrid();
  persistSettings();
}
function persistSettings() { window.api.updateSettings({ lastTool: tool, lastColor: color, lastSize: size }); }

// ═══════════ 抽屉：页面 & 书签 ═══════════
let drawerMode = null;
function toggleDrawer(mode) {
  const sb = $("#sidebar");
  if (!sb.classList.contains("hidden") && drawerMode === mode) { sb.classList.add("hidden"); return; }
  sb.classList.remove("hidden"); drawerMode = mode;
  $("#drawerTitle").textContent = mode === "pages" ? "页面" : "书签";
  $("#btnAddPage").classList.toggle("hidden", mode !== "pages");
  $("#pageList").classList.toggle("hidden", mode !== "pages");
  $("#bookmarkList").classList.toggle("hidden", mode !== "bookmarks");
  if (mode === "pages") renderThumbs(); else renderBookmarks();
}
async function toggleBookmark() {
  const p = curPage();
  if (p.bookmark) { p.bookmark = null; toast("已移除书签"); }
  else { const t = await modalInput({ title: "添加书签", value: `第 ${pageIdx + 1} 页`, placeholder: "书签名称" }); if (t === null) return; p.bookmark = t.trim() || `第 ${pageIdx + 1} 页`; toast("已加书签"); }
  const bp = $("#btnBookmarkPage"); if (bp) bp.textContent = p.bookmark ? "★" : "☆";
  save(); if (drawerMode === "bookmarks") renderBookmarks(); renderThumbs();
}
function renderBookmarks() {
  const list = $("#bookmarkList");
  const marks = nb.pages.map((p, i) => ({ p, i })).filter((x) => x.p.bookmark);
  if (!marks.length) { list.innerHTML = `<div class="bm-empty">还没有书签<br>用顶栏 ☆ 给页面加书签</div>`; return; }
  list.innerHTML = marks.map((m) => `<div class="bm-item" data-i="${m.i}">🔖 <span>${escapeHtml(m.p.bookmark)}</span></div>`).join("");
  $$("#bookmarkList .bm-item").forEach((el) => el.addEventListener("click", () => gotoPage(+el.dataset.i)));
}

// ═══════════ 导入 / 导出菜单 ═══════════
function bindMenus() {
  const toggle = (id) => { const m = $(id); const open = m.classList.contains("open"); $$(".dropdown").forEach((d) => d.classList.remove("open")); if (!open) m.classList.add("open"); };
  $("#btnImport").addEventListener("click", (e) => { e.stopPropagation(); toggle("#importMenu"); });
  $("#btnExport").addEventListener("click", (e) => { e.stopPropagation(); toggle("#exportMenu"); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".dropdown") && e.target.id !== "btnImport" && e.target.id !== "btnExport") $$(".dropdown").forEach((d) => d.classList.remove("open")); });
  $$("#importMenu button").forEach((b) => b.addEventListener("click", () => ({ image: importImage, pdf: importPdf, xopp: importXopp }[b.dataset.imp]())));
  $$("#exportMenu button").forEach((b) => b.addEventListener("click", () => ({ png: () => exportRaster("png"), jpg: () => exportRaster("jpg"), pdf: exportPdf, xopp: exportXopp }[b.dataset.exp]())));
}

// ═══════════ 绘制引擎 ═══════════
let drawing = false, cur = null, panning = false, panStart = null;
let lassoPts = null, sel = null, selDragLast = null;   // 套索
let selGesture = null;   // {type:'move'|'scale'|'rotate', ...}
let shotStart = null, lastShotPt = null;   // 截图笔框选

function bindDrawing() {
  ink.addEventListener("pointerdown", onDown);
  ink.addEventListener("pointermove", onMove);
  ink.addEventListener("pointerup", onUp);
  ink.addEventListener("pointercancel", onUp);
  ink.addEventListener("pointerleave", () => { if (drawing && tool !== "eraser") onUp(); });
  stage.addEventListener("wheel", (e) => {
    if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }
    else { panX -= e.deltaX; panY -= e.deltaY; applyTransform(); }
  }, { passive: false });
  bindTextLayer();
}

function onDown(e) {
  const pt = toLogical(e);
  if (tool === "pan") { panning = true; panStart = { x: e.clientX - panX, y: e.clientY - panY }; ink.setPointerCapture(e.pointerId); return; }
  if (tool === "text") return; // 文本层处理
  ink.setPointerCapture(e.pointerId);
  if (tool === "lasso") {
    if (sel) {
      const g = hitSelHandle(pt);
      if (g) { selGesture = g; return; }
    }
    clearSelection(); lassoPts = [pt]; return;
  }
  if (tool === "cover") { drawing = true; coverStart = pt; return; }
  if (tool === "shot") { drawing = true; shotStart = pt; lastShotPt = pt; return; }
  if (tool === "laser") { drawing = true; laserCur = { color: "#ff2d55", size: 4, points: [pt] }; return; }
  drawing = true;
  cur = { tool: tool === "highlighter" ? "highlighter" : "pen", color, size, points: [pt] };
  if (tool === "eraser") { drawing = true; cur = { tool: "eraser", points: [pt] }; erasedThisStroke = false; eraseAt(pt); drawEraserCursor(pt); }
}
function onMove(e) {
  const pt = toLogical(e);
  if (panning) { panX = e.clientX - panStart.x; panY = e.clientY - panStart.y; applyTransform(); return; }
  if (tool === "lasso") {
    if (selGesture) { updateSelGesture(pt); return; }
    if (lassoPts) { lassoPts.push(pt); drawLasso(); }
    return;
  }
  if (!drawing) return;
  if (tool === "eraser") { cur.points.push(pt); eraseAt(pt); drawEraserCursor(pt); return; }
  if (tool === "cover") { drawCoverPreview(coverStart, pt); return; }
  if (tool === "shot") { drawShotPreview(shotStart, pt); return; }
  if (tool === "laser") { laserCur.points.push(pt); drawLaserLive(); return; }
  cur.points.push(pt); drawStrokeLive();
}
function onUp() {
  if (panning) { panning = false; return; }
  if (tool === "lasso") {
    if (selGesture) { selGesture = null; save(); renderThumbs(); drawSelection(); return; }
    if (lassoPts && lassoPts.length > 2) finalizeLasso();
    lassoPts = null; return;
  }
  if (!drawing) return;
  drawing = false;
  if (tool === "cover") { octx.clearRect(0, 0, PAGE_W, PAGE_H); if (coverStart) finalizeCover(coverStart, lastCoverPt); coverStart = null; return; }
  if (tool === "shot") { octx.clearRect(0, 0, PAGE_W, PAGE_H); if (shotStart) finalizeShot(shotStart, lastShotPt); shotStart = null; return; }
  if (tool === "laser") { if (laserCur && laserCur.points.length) pushLaserTrail(laserCur.points); laserCur = null; return; }   // 激光笔痕迹自动淡出，不留存
  if (tool === "eraser") { cur = null; octx.clearRect(0, 0, PAGE_W, PAGE_H); if (erasedThisStroke) { save(); renderThumbs(); } erasedThisStroke = false; return; }
  if (cur && cur.points.length) {
    if (tool === "shape") cur = recognizeShape(cur);
    pushUndo(); curPage().strokes.push(cur); save(); renderInk(); renderThumbs();
  }
  cur = null;
}

// 单条 stroke 画到 context
function strokePath(ctx, s) {
  const pts = s.points; if (!pts.length) return;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (s.tool === "highlighter") { ctx.globalAlpha = 0.35; ctx.strokeStyle = s.color; ctx.lineWidth = s.size * 3; }
  else { ctx.globalAlpha = 1; ctx.strokeStyle = s.color; ctx.lineWidth = s.size; }
  if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = 1; return; }
  if (s.tool === "pen") {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      ctx.beginPath(); ctx.lineWidth = Math.max(0.5, s.size * (0.5 + (a.p + b.p) / 2));
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  } else {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function drawStrokeLive() {
  ictx.clearRect(0, 0, PAGE_W, PAGE_H);
  for (const s of curPage().strokes) strokePath(ictx, s);
  if (cur) strokePath(ictx, cur);
}
let erasedThisStroke = false;
// 点到线段最近距离（用于精准判断笔画是否被橡皮碰到）
function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  if (!L) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function eraseAt(pt) {
  const strokes = curPage().strokes;
  if (eraserMode === "pixel") {
    const r = eraserSize / 2;
    let changed = false; const out = [];
    for (const s of strokes) {
      const half = (s.tool === "highlighter" ? s.size * 3 : s.size) / 2;
      const reach = r + half;
      // 快速跳过：整条笔画都离橡皮很远
      const near = s.points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < reach) ||
        (() => { for (let i = 1; i < s.points.length; i++) if (distToSeg(pt, s.points[i - 1], s.points[i]) < reach) return true; return false; })();
      if (!near) { out.push(s); continue; }
      // 先把路径加密（≤4px 一点），这样能把橡皮经过处精确地从中间挖断，两头保留
      const dense = [];
      const pts = s.points;
      if (pts.length === 1) dense.push(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(d / 4));
        if (i === 1) dense.push(a);
        for (let k = 1; k <= steps; k++) dense.push({ x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps, p: b.p ?? 0.5 });
      }
      // 按「是否落在橡皮半径内」把加密后的点切成若干保留段
      let seg = [];
      for (const p of dense) {
        if (Math.hypot(p.x - pt.x, p.y - pt.y) < r + half) {
          if (seg.length >= 2) out.push({ ...s, points: seg });
          seg = [];
        } else seg.push(p);
      }
      if (seg.length >= 2) out.push({ ...s, points: seg });
      changed = true;
    }
    if (changed) {
      if (!erasedThisStroke) { pushUndo(); erasedThisStroke = true; }
      curPage().strokes = out; renderInk();
    }
    return;
  }
  // 整笔擦除
  const r = 14;
  let hit = -1;
  for (let i = strokes.length - 1; i >= 0; i--) if (strokes[i].points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < r)) { hit = i; break; }
  if (hit >= 0) { if (!erasedThisStroke) { pushUndo(); erasedThisStroke = true; } strokes.splice(hit, 1); renderInk(); }
}

function drawEraserCursor(pt) {
  if (eraserMode !== "pixel") return;
  octx.clearRect(0, 0, PAGE_W, PAGE_H);
  octx.save(); octx.strokeStyle = "#ff3b30"; octx.lineWidth = 1.5 / zoom; octx.setLineDash([4 / zoom, 3 / zoom]);
  octx.beginPath(); octx.arc(pt.x, pt.y, eraserSize / 2, 0, Math.PI * 2); octx.stroke(); octx.restore();
}

// ═══════════ 挖空笔（遮挡背诵：盖住一块区域，点一下开/合） ═══════════
let coverStart = null, lastCoverPt = null;
function drawCoverPreview(a, b) {
  lastCoverPt = b;
  octx.clearRect(0, 0, PAGE_W, PAGE_H);
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  octx.save(); octx.fillStyle = "rgba(60,60,67,.55)"; octx.strokeStyle = "#3c3c43"; octx.lineWidth = 1.5 / zoom;
  octx.fillRect(x, y, w, h); octx.strokeRect(x, y, w, h); octx.restore();
}
function finalizeCover(a, b) {
  if (!b) return;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  if (w < 12 || h < 12) return;
  const p = curPage(); p.covers = p.covers || [];
  uid().then((id) => { p.covers.push({ id, x, y, w, h, color: "#3c3c43", open: false }); save(); renderCovers(); });
}
function renderCovers() {
  const layer = $("#coverLayer"); if (!layer) return;
  const covers = curPage().covers || [];
  layer.innerHTML = covers.map((c) => `<div class="cover-box${c.open ? " open" : ""}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;--cc:${c.color || "#3c3c43"}">
    <button class="cover-del" data-cdel="${c.id}">✕</button></div>`).join("");
  $$("#coverLayer .cover-box").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.dataset.cdel != null) return;
      const c = covers.find((x) => x.id === el.dataset.id); if (!c) return;
      c.open = !c.open; el.classList.toggle("open", c.open); save();
    });
    const del = el.querySelector("[data-cdel]");
    if (del) del.addEventListener("click", (e) => { e.stopPropagation(); curPage().covers = covers.filter((x) => x.id !== del.dataset.cdel); save(); renderCovers(); });
  });
}

// ═══════════ 激光笔（临时高亮，短暂停留后自动淡出，不留存） ═══════════
let laserCur = null, laserTrails = [], laserRAF = 0;
function drawLaserLive() {
  octx.clearRect(0, 0, PAGE_W, PAGE_H);
  drawLaserStroke(laserCur.points, 1);
}
function drawLaserStroke(pts, alpha) {
  if (pts.length < 1) return;
  octx.save();
  octx.globalAlpha = alpha; octx.lineJoin = octx.lineCap = "round";
  octx.strokeStyle = "#ff2d55"; octx.shadowColor = "#ff2d55"; octx.shadowBlur = 14 / zoom; octx.lineWidth = 5 / zoom;
  octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts) octx.lineTo(p.x, p.y);
  octx.stroke();
  octx.strokeStyle = "rgba(255,255,255,.9)"; octx.shadowBlur = 0; octx.lineWidth = 2 / zoom;
  octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts) octx.lineTo(p.x, p.y);
  octx.stroke();
  octx.restore();
}
function pushLaserTrail(pts) {
  laserTrails.push({ points: pts, born: Date.now() });
  if (!laserRAF) laserRAF = requestAnimationFrame(laserTick);
}
function laserTick() {
  const now = Date.now(), LIFE = 700;
  laserTrails = laserTrails.filter((t) => now - t.born < LIFE);
  if (tool === "laser" && !drawing) octx.clearRect(0, 0, PAGE_W, PAGE_H);
  for (const t of laserTrails) drawLaserStroke(t.points, Math.max(0, 1 - (now - t.born) / LIFE));
  if (laserTrails.length) laserRAF = requestAnimationFrame(laserTick);
  else { laserRAF = 0; if (tool === "laser") octx.clearRect(0, 0, PAGE_W, PAGE_H); }
}

// ═══════════ 截图笔（框选区域→底部预览→点击插入为图片） ═══════════
function drawShotPreview(a, b) {
  lastShotPt = b;
  octx.clearRect(0, 0, PAGE_W, PAGE_H);
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  octx.save();
  // 暗化外部 + 亮出选区（iOS 截图风）
  octx.fillStyle = "rgba(0,0,0,.28)";
  octx.fillRect(0, 0, PAGE_W, y); octx.fillRect(0, y + h, PAGE_W, PAGE_H - y - h);
  octx.fillRect(0, y, x, h); octx.fillRect(x + w, y, PAGE_W - x - w, h);
  octx.strokeStyle = "#007AFF"; octx.lineWidth = 1.5 / zoom; octx.setLineDash([6 / zoom, 4 / zoom]);
  octx.strokeRect(x, y, w, h);
  octx.restore();
}
// 把逻辑矩形区域的画布内容（背景+笔迹+图片+卡片）合成成 dataURL
function captureRegion(x, y, w, h) {
  const full = flattenPage(pageIdx);   // 完整页面合成（含 bg/strokes/texts/cards/images）
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const cx = c.getContext("2d");
  cx.drawImage(full, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}
async function finalizeShot(a, b) {
  if (!b) return;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  if (w < 12 || h < 12) return;
  const dataUrl = captureRegion(x, y, w, h);
  shots.push({ id: await uid(), dataUrl, w, h });
  renderShotTray(); toast("已截图，点底部预览插入");
}
function renderShotTray() {
  const tray = $("#shotTray"); if (!tray) return;
  tray.classList.toggle("hidden", !shots.length);
  tray.innerHTML = shots.map((s) => `<div class="shot-item" data-id="${s.id}" title="点击插入到笔记">
      <img src="${s.dataUrl}" alt="截图">
      <button class="shot-del" data-sdel="${s.id}">✕</button>
    </div>`).join("");
  $$("#shotTray .shot-item").forEach((el) => {
    el.addEventListener("click", (e) => { if (e.target.dataset.sdel != null) return; insertShot(el.dataset.id); });
    const del = el.querySelector("[data-sdel]");
    if (del) del.addEventListener("click", (e) => { e.stopPropagation(); shots = shots.filter((x) => x.id !== del.dataset.sdel); renderShotTray(); });
  });
}
// 点预览：把截图作为可拖动图片贴到当前页中央
async function insertShot(id) {
  const s = shots.find((x) => x.id === id); if (!s) return;
  const p = curPage(); p.images = p.images || [];
  const cx = (-panX / zoom) + (stage.clientWidth / zoom) / 2, cy = (-panY / zoom) + (stage.clientHeight / zoom) / 2;
  // 落地尺寸：不超过页面 70%
  let iw = s.w, ih = s.h; const maxW = PAGE_W * 0.7, maxH = PAGE_H * 0.7;
  const sc = Math.min(1, maxW / iw, maxH / ih); iw *= sc; ih *= sc;
  const img = { id: await uid(), dataUrl: s.dataUrl, x: Math.max(10, cx - iw / 2), y: Math.max(10, cy - ih / 2), w: iw, h: ih };
  p.images.push(img); save(); mountImage(img);
  toast("已插入截图，用套索工具可拖动放置");
}
function bindShotTray() { renderShotTray(); }

// ═══════════ 图片对象层（截图/导入图片，可拖动缩放） ═══════════
function renderImages() {
  const layer = $("#imageLayer"); if (!layer) return;
  layer.innerHTML = "";
  for (const im of curPage().images || []) mountImage(im);
}
function mountImage(im) {
  const layer = $("#imageLayer");
  const el = document.createElement("div");
  el.className = "img-obj"; el.dataset.id = im.id;
  el.style.cssText = `left:${im.x}px;top:${im.y}px;width:${im.w}px;height:${im.h}px`;
  el.innerHTML = `<img src="${im.dataUrl}" draggable="false" alt="图片">
    <button class="img-del" title="删除">✕</button>
    <span class="img-resize" title="缩放"></span>`;
  const bodyDrag = (e) => {
    if (e.target.classList.contains("img-del") || e.target.classList.contains("img-resize")) return;
    e.preventDefault(); e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY }, origin = { x: im.x, y: im.y };
    el.setPointerCapture(e.pointerId); el.classList.add("moving");
    const mv = (ev) => { im.x = origin.x + (ev.clientX - start.x) / zoom; im.y = origin.y + (ev.clientY - start.y) / zoom; el.style.left = im.x + "px"; el.style.top = im.y + "px"; };
    const up = () => { el.classList.remove("moving"); el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); save(); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up);
  };
  el.addEventListener("pointerdown", bodyDrag);
  el.querySelector(".img-del").addEventListener("click", (e) => {
    e.stopPropagation(); curPage().images = (curPage().images || []).filter((x) => x.id !== im.id); el.remove(); save();
  });
  const rz = el.querySelector(".img-resize");
  rz.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY }, ow = im.w, oh = im.h, ratio = im.w / im.h;
    rz.setPointerCapture(e.pointerId);
    const mv = (ev) => { let w = Math.max(30, ow + (ev.clientX - start.x) / zoom); im.w = w; im.h = w / ratio; el.style.width = im.w + "px"; el.style.height = im.h + "px"; };
    const up = () => { rz.removeEventListener("pointermove", mv); rz.removeEventListener("pointerup", up); save(); };
    rz.addEventListener("pointermove", mv); rz.addEventListener("pointerup", up);
  });
  layer.appendChild(el);
}

// ═══════════ 卡片（便签 / 知识卡片） ═══════════
const CARD_COLORS = ["#fff4c2", "#d8f0ff", "#ffe0e6", "#e2f7d8", "#ececf4"];
async function addCard() {
  const p = curPage(); p.cards = p.cards || [];
  const cx = (-panX / zoom) + (stage.clientWidth / zoom) / 2, cy = (-panY / zoom) + (stage.clientHeight / zoom) / 2;
  const card = { id: await uid(), x: Math.max(20, cx - 110), y: Math.max(20, cy - 80), w: 220, h: 160,
    content: "", color: CARD_COLORS[p.cards.length % CARD_COLORS.length] };
  p.cards.push(card); save(); mountCard(card, true); toast("已添加卡片");
}
function renderCards() {
  const layer = $("#cardLayer"); if (!layer) return;
  layer.innerHTML = "";
  for (const c of curPage().cards || []) mountCard(c, false);
}
function mountCard(c, edit) {
  const layer = $("#cardLayer");
  const el = document.createElement("div");
  el.className = "card-note"; el.dataset.id = c.id;
  el.style.cssText = `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;background:${c.color}`;
  el.innerHTML = `<div class="card-bar"><button class="card-del" title="删除">✕</button></div>
    <div class="card-body" contenteditable="true" spellcheck="false"></div>`;
  const body = el.querySelector(".card-body"); body.textContent = c.content;
  const bar = el.querySelector(".card-bar");
  body.addEventListener("blur", () => { c.content = body.textContent; save(); });
  el.querySelector(".card-del").addEventListener("click", () => {
    curPage().cards = (curPage().cards || []).filter((x) => x.id !== c.id); el.remove(); save();
  });
  // 拖动（抓标题栏）
  let dragging = false, start = null, origin = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("card-del")) return;
    dragging = true; start = { x: e.clientX, y: e.clientY }; origin = { x: c.x, y: c.y };
    bar.setPointerCapture(e.pointerId); e.preventDefault();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    c.x = origin.x + (e.clientX - start.x) / zoom; c.y = origin.y + (e.clientY - start.y) / zoom;
    el.style.left = c.x + "px"; el.style.top = c.y + "px";
  });
  bar.addEventListener("pointerup", () => { if (dragging) { dragging = false; save(); } });
  layer.appendChild(el);
  if (edit) setTimeout(() => body.focus(), 0);
}

// ═══════════ 套索选择 ═══════════
function drawLasso() {
  octx.clearRect(0, 0, PAGE_W, PAGE_H);
  octx.save(); octx.strokeStyle = "#2f7be6"; octx.lineWidth = 2 / zoom; octx.setLineDash([8 / zoom, 6 / zoom]);
  octx.beginPath(); octx.moveTo(lassoPts[0].x, lassoPts[0].y);
  for (const p of lassoPts) octx.lineTo(p.x, p.y);
  octx.stroke(); octx.restore();
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function finalizeLasso() {
  const poly = lassoPts.slice();
  const idx = [];
  curPage().strokes.forEach((s, i) => {
    const inside = s.points.filter((p) => pointInPoly(p, poly)).length;
    if (inside >= s.points.length * 0.6) idx.push(i);
  });
  if (!idx.length) { octx.clearRect(0, 0, PAGE_W, PAGE_H); hideSelBar(); return; }
  selectStrokes(idx.map((i) => curPage().strokes[i]));
}
// 由一组 stroke 建立选区（变换框套在它们上）
function selectStrokes(strokes) {
  if (!strokes.length) { clearSelection(); return; }
  const orig = strokes.map((s) => s.points.map((p) => ({ ...p })));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of orig) for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const pad = 12;
  sel = {
    strokes, orig,
    box: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad },
    ocx: (x0 + x1) / 2, ocy: (y0 + y1) / 2,
    tx: 0, ty: 0, rot: 0, sc: 1,
  };
  applySelTransform();
  drawSelection();
}
// 变换手柄坐标：center + R(rot)·(局部偏移·sc)
function selCenter() { return { x: sel.ocx + sel.tx, y: sel.ocy + sel.ty }; }
function selHandles() {
  const c = selCenter(), hw = (sel.box.x1 - sel.box.x0) / 2 * sel.sc, hh = (sel.box.y1 - sel.box.y0) / 2 * sel.sc;
  const cos = Math.cos(sel.rot), sin = Math.sin(sel.rot);
  const R = (lx, ly) => ({ x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos });
  return {
    corners: [R(-hw, -hh), R(hw, -hh), R(hw, hh), R(-hw, hh)],
    rotate: R(0, -hh - 40 / zoom),
    center: c, hw, hh,
  };
}
function applySelTransform() {
  const cos = Math.cos(sel.rot), sin = Math.sin(sel.rot);
  sel.strokes.forEach((s, i) => {
    s.points = sel.orig[i].map((p) => {
      let vx = (p.x - sel.ocx) * sel.sc, vy = (p.y - sel.ocy) * sel.sc;
      const rx = vx * cos - vy * sin, ry = vx * sin + vy * cos;
      return { ...p, x: sel.ocx + rx + sel.tx, y: sel.ocy + ry + sel.ty };
    });
  });
  renderInk();
}
function drawSelection() {
  octx.clearRect(0, 0, PAGE_W, PAGE_H);
  if (!sel) { hideSelBar(); return; }
  const h = selHandles();
  octx.save();
  octx.strokeStyle = "#2f7be6"; octx.lineWidth = 1.5 / zoom; octx.setLineDash([6 / zoom, 4 / zoom]);
  octx.beginPath(); octx.moveTo(h.corners[0].x, h.corners[0].y);
  for (const c of h.corners.slice(1)) octx.lineTo(c.x, c.y);
  octx.closePath();
  octx.fillStyle = "rgba(47,123,230,.06)"; octx.fill(); octx.stroke();
  octx.setLineDash([]);
  // 旋转手柄连杆
  const top = { x: (h.corners[0].x + h.corners[1].x) / 2, y: (h.corners[0].y + h.corners[1].y) / 2 };
  octx.beginPath(); octx.moveTo(top.x, top.y); octx.lineTo(h.rotate.x, h.rotate.y); octx.stroke();
  const hr = 6 / zoom;
  octx.fillStyle = "#fff"; octx.strokeStyle = "#2f7be6"; octx.lineWidth = 2 / zoom;
  for (const c of h.corners) { octx.beginPath(); octx.rect(c.x - hr, c.y - hr, hr * 2, hr * 2); octx.fill(); octx.stroke(); }
  octx.beginPath(); octx.arc(h.rotate.x, h.rotate.y, hr, 0, Math.PI * 2); octx.fill(); octx.stroke();
  octx.restore();
  positionSelBar(h);
}
function positionSelBar(h) {
  const bar = $("#selBar"); if (!bar) return;
  // 选区中心下方（屏幕坐标）
  const r = ink.getBoundingClientRect();
  let maxY = -Infinity; for (const c of h.corners) maxY = Math.max(maxY, c.y);
  const sx = r.left + h.center.x * zoom, sy = r.top + maxY * zoom + 14;
  bar.classList.remove("hidden");
  bar.style.left = sx + "px"; bar.style.top = sy + "px";
}
function hideSelBar() { const b = $("#selBar"); if (b) b.classList.add("hidden"); }
// 命中手柄：返回手势描述，或 move（在框内），或 null
function hitSelHandle(pt) {
  const h = selHandles(), tol = 12 / zoom;
  if (Math.hypot(pt.x - h.rotate.x, pt.y - h.rotate.y) < tol)
    return { type: "rotate", startAng: Math.atan2(pt.y - h.center.y, pt.x - h.center.x), startRot: sel.rot };
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(pt.x - h.corners[i].x, pt.y - h.corners[i].y) < tol) {
      const c = selCenter(), d0 = Math.hypot(pt.x - c.x, pt.y - c.y);
      return { type: "scale", startDist: d0 || 1, startSc: sel.sc };
    }
  }
  // 框内 → 移动（用未旋转局部坐标判断）
  const c = selCenter(), cos = Math.cos(-sel.rot), sin = Math.sin(-sel.rot);
  const lx = (pt.x - c.x) * cos - (pt.y - c.y) * sin, ly = (pt.x - c.x) * sin + (pt.y - c.y) * cos;
  if (Math.abs(lx) <= h.hw && Math.abs(ly) <= h.hh) return { type: "move", last: pt };
  return null;
}
function updateSelGesture(pt) {
  const g = selGesture;
  if (g.type === "move") { sel.tx += pt.x - g.last.x; sel.ty += pt.y - g.last.y; g.last = pt; }
  else if (g.type === "rotate") {
    const c = selCenter(), a = Math.atan2(pt.y - c.y, pt.x - c.x);
    sel.rot = g.startRot + (a - g.startAng);
  } else if (g.type === "scale") {
    const c = selCenter(), d = Math.hypot(pt.x - c.x, pt.y - c.y);
    sel.sc = Math.max(0.1, g.startSc * (d / g.startDist));
  }
  applySelTransform(); drawSelection();
}
function recolorSelection(c) {
  if (!sel) return;
  pushUndo();
  for (const s of sel.strokes) s.color = c;
  save(); renderInk(); renderThumbs();
}
function duplicateSelection() {
  if (!sel) return;
  pushUndo();
  const copies = sel.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, x: p.x + 24, y: p.y + 24 })) }));
  curPage().strokes.push(...copies);
  save(); renderInk(); renderThumbs();
  // 立刻把新副本设为当前选区，方便用户马上拖动/操作
  selectStrokes(copies); toast("已复制副本，可直接拖动");
}
function deleteSelection() {
  if (!sel) return;
  pushUndo();
  curPage().strokes = curPage().strokes.filter((s) => !sel.strokes.includes(s));
  clearSelection(); save(); renderInk(); renderThumbs();
}
function clearSelection() { sel = null; selDragLast = null; lassoPts = null; selGesture = null; octx.clearRect(0, 0, PAGE_W, PAGE_H); hideSelBar(); }
function bindSelBar() {
  const ci = $("#selColorInput");
  on("#selColor", "click", () => ci.click());
  ci.addEventListener("input", (e) => { $("#selColor .sel-dot").style.background = e.target.value; recolorSelection(e.target.value); });
  on("#selDup", "click", duplicateSelection);
  on("#selDel", "click", deleteSelection);
}

// ═══════════ 形状识别 ═══════════
function recognizeShape(stroke) {
  const pts = stroke.points; const base = { tool: "pen", color: stroke.color, size: stroke.size };
  if (pts.length < 3) return stroke;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  const closed = Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) < diag * 0.25;
  const corners = rdp(pts, diag * 0.06);
  const mk = (arr) => ({ ...base, points: densify(arr).map((p) => ({ ...p, p: 0.6 })) });
  if (!closed) {
    // 开放：判断是否近似直线
    return mk([{ x: pts[0].x, y: pts[0].y }, { x: pts.at(-1).x, y: pts.at(-1).y }]);
  }
  const n = corners.length - 1; // 去掉重复闭合点
  if (n === 3) return mk([...corners.slice(0, 3), corners[0]]);            // 三角形
  if (n === 4) return mk([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]); // 矩形
  return mk(ellipsePts(x0, y0, x1, y1));                                    // 圆/椭圆
}
function ellipsePts(x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2, out = [];
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 32) out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  return out;
}
function densify(arr) {
  const out = [];
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1], d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.round(d / 8));
    for (let s = 0; s < steps; s++) out.push({ x: a.x + (b.x - a.x) * s / steps, y: a.y + (b.y - a.y) * s / steps });
  }
  out.push(arr.at(-1)); return out;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0; const a = pts[0], b = pts.at(-1);
  for (let i = 1; i < pts.length - 1; i++) { const d = pointLineDist(pts[i], a, b); if (d > maxD) { maxD = d; idx = i; } }
  if (maxD > eps) { const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps); return l.slice(0, -1).concat(r); }
  return [a, b];
}
function pointLineDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  if (!L) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ═══════════ 文本框 ═══════════
let activeText = null;
function bindTextLayer() {
  textLayer.addEventListener("pointerdown", (e) => {
    if (tool !== "text") return;
    if (e.target === textLayer) {
      const r = textLayer.getBoundingClientRect();
      const x = (e.clientX - r.left) / zoom, y = (e.clientY - r.top) / zoom;
      createText({ id: null, x, y, w: 300, content: "", color, size: Math.max(16, size * 6) }, true);
    }
  });
}
function renderTexts() {
  textLayer.innerHTML = "";
  for (const t of curPage().texts || []) mountText(t, false);
}
async function createText(t, edit) {
  if (t.id === null) t.id = await uid();
  curPage().texts = curPage().texts || [];
  curPage().texts.push(t);
  mountText(t, edit); save();
}
function mountText(t, edit) {
  const el = document.createElement("div");
  el.className = "text-box"; el.contentEditable = "true"; el.spellcheck = false;
  el.style.left = t.x + "px"; el.style.top = t.y + "px";
  el.style.color = t.color; el.style.fontSize = t.size + "px"; el.style.minWidth = "40px";
  el.textContent = t.content;
  let dragging = false, moved = false, start = null, origin = null;
  el.addEventListener("pointerdown", (e) => {
    if (tool !== "text") return;
    if (el.classList.contains("editing")) return;      // 编辑中不拖
    e.preventDefault(); dragging = true; moved = false;
    start = { x: e.clientX, y: e.clientY }; origin = { x: t.x, y: t.y };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = (e.clientX - start.x) / zoom, dy = (e.clientY - start.y) / zoom;
    if (Math.hypot(dx * zoom, dy * zoom) > 4) moved = true;
    t.x = origin.x + dx; t.y = origin.y + dy; el.style.left = t.x + "px"; el.style.top = t.y + "px";
  });
  el.addEventListener("pointerup", (e) => {
    if (!dragging) return; dragging = false;
    if (moved) { save(); } else { el.classList.add("editing"); el.focus(); placeCaretEnd(el); }
  });
  el.addEventListener("blur", () => {
    el.classList.remove("editing"); t.content = el.textContent;
    if (!t.content.trim()) { curPage().texts = curPage().texts.filter((x) => x.id !== t.id); el.remove(); }
    save();
  });
  textLayer.appendChild(el);
  if (edit) { el.classList.add("editing"); setTimeout(() => el.focus(), 0); }
}
function placeCaretEnd(el) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function closeText() { if (document.activeElement && document.activeElement.classList?.contains("text-box")) document.activeElement.blur(); }

// ═══════════ 纸张模板 ═══════════
function baseOf(tpl) {
  if (["blank", "lined", "grid", "cornell", "dots"].includes(tpl)) return tpl;
  const c = customTemplates.find((t) => t.id === tpl); return c ? c.base : "blank";
}
function customOf(tpl) { return customTemplates.find((t) => t.id === tpl) || null; }
// 画底纹（供内建 & 自定义共用）：cfg = {base, spacing, paperColor, lineColor, guideColor, guides}
function paintPattern(cx, cfg) {
  const { base = "blank", spacing = 46, paperColor = "#ffffff", lineColor = "#c9d6e5", guideColor = "#e2453b", guides = [] } = cfg;
  cx.fillStyle = paperColor; cx.fillRect(0, 0, PAGE_W, PAGE_H);
  cx.strokeStyle = lineColor; cx.lineWidth = 1;
  if (base === "lined") { for (let y = spacing; y < PAGE_H; y += spacing) line(cx, 50, y, PAGE_W - 50, y); }
  else if (base === "grid") { for (let x = spacing; x < PAGE_W; x += spacing) line(cx, x, 0, x, PAGE_H); for (let y = spacing; y < PAGE_H; y += spacing) line(cx, 0, y, PAGE_W, y); }
  else if (base === "dots") {
    cx.fillStyle = lineColor;
    for (let x = spacing; x < PAGE_W; x += spacing) for (let y = spacing; y < PAGE_H; y += spacing) { cx.beginPath(); cx.arc(x, y, 2, 0, Math.PI * 2); cx.fill(); }
  } else if (base === "cornell") {
    for (let x = spacing; x < PAGE_W; x += spacing) line(cx, x, 0, x, PAGE_H);
    for (let y = spacing; y < PAGE_H; y += spacing) line(cx, 0, y, PAGE_W, y);
    cx.strokeStyle = guideColor; cx.lineWidth = 2.5;
    line(cx, PAGE_W - 320, 0, PAGE_W - 320, PAGE_H - 300);
    line(cx, 0, PAGE_H - 300, PAGE_W, PAGE_H - 300);
  }
  // 用户添加的参考线
  if (guides.length) {
    cx.strokeStyle = guideColor; cx.lineWidth = 2;
    for (const g of guides) g.type === "h" ? line(cx, 0, g.pos, PAGE_W, g.pos) : line(cx, g.pos, 0, g.pos, PAGE_H);
  }
}
function paintTemplate(cx, page) {
  const tpl = page.template || "blank";
  const custom = customOf(tpl);
  if (custom) paintPattern(cx, custom);
  else paintPattern(cx, { base: baseOf(tpl) });
  const img = getBg(page);
  if (img && img.complete && img.naturalWidth) { const sc = PAGE_W / img.naturalWidth; cx.drawImage(img, 0, 0, PAGE_W, img.naturalHeight * sc); }
}
function line(cx, x0, y0, x1, y1) { cx.beginPath(); cx.moveTo(x0, y0); cx.lineTo(x1, y1); cx.stroke(); }
function roundRect(cx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
function getBg(page) {
  if (!page.bg) return null;
  if (bgCache.has(page.id)) return bgCache.get(page.id);
  const img = new Image(); img.onload = () => { if (page === curPage()) drawPaper(); renderThumbs(); };
  img.src = page.bg; bgCache.set(page.id, img); return img;
}
function buildTemplatePicker() {
  const builtins = [{ id: "blank", name: "空白" }, { id: "lined", name: "横线" }, { id: "grid", name: "网格" }, { id: "cornell", name: "康奈尔" }];
  const all = builtins.concat(customTemplates.map((t) => ({ id: t.id, name: t.name, custom: true })));
  const cur = curPage().template || "blank";
  $("#tplGrid").innerHTML = all.map((t) => `<div class="tpl ${t.id === cur ? "on" : ""}" data-t="${t.id}"><canvas width="60" height="80"></canvas><span class="tn">${escapeHtml(t.name)}</span>${t.custom ? `<span class="tdel" data-del="${t.id}">✕</span>` : ""}</div>`).join("");
  $$("#tplGrid .tpl").forEach((el) => {
    const c = el.querySelector("canvas"), cx = c.getContext("2d"); cx.scale(c.width / PAGE_W, c.height / PAGE_H);
    paintTemplate(cx, { template: el.dataset.t, bg: null, id: "prev" });
    el.addEventListener("click", (e) => { if (e.target.dataset.del != null) return; setTemplate(el.dataset.t); });
    const del = el.querySelector("[data-del]"); if (del) del.addEventListener("click", (e) => { e.stopPropagation(); delTemplate(del.dataset.del); });
  });
}
function setTemplate(t) { curPage().template = t; save(); drawPaper(); renderThumbs(); buildTemplatePicker(); }
function delTemplate(id) {
  customTemplates = customTemplates.filter((t) => t.id !== id);
  window.api.updateSettings({ customTemplates });
  if (curPage().template === id) setTemplate("blank"); else buildTemplatePicker();
}

// ═══════════ 自定义模板编辑器 ═══════════
let teCfg = null;
function openTemplateEditor() {
  $("#morePanel").classList.add("hidden");
  teCfg = { base: "grid", spacing: 46, paperColor: "#ffffff", lineColor: "#c9d6e5", guideColor: "#e2453b", guides: [] };
  $("#teName").value = "我的模板";
  $$("#teBase .seg-btn").forEach((b) => b.classList.toggle("on", b.dataset.base === teCfg.base));
  $("#teSpacing").value = teCfg.spacing; $("#teSpacingVal").textContent = teCfg.spacing;
  $("#tePaper").value = teCfg.paperColor; $("#teLine").value = teCfg.lineColor; $("#teGuideColor").value = teCfg.guideColor;
  renderTeGuides(); drawTePreview();
  $("#tplEditor").classList.remove("hidden");
}
function closeTemplateEditor() { $("#tplEditor").classList.add("hidden"); teCfg = null; }
function drawTePreview() {
  const c = $("#tePreview"), cx = c.getContext("2d");
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, c.width, c.height);
  cx.scale(c.width / PAGE_W, c.height / PAGE_H);
  paintPattern(cx, teCfg);
}
function renderTeGuides() {
  const list = $("#teGuideList");
  list.innerHTML = teCfg.guides.map((g, i) =>
    `<div class="te-guide-row"><span>${g.type === "h" ? "水平" : "垂直"}</span>
     <input type="range" min="0" max="${g.type === "h" ? PAGE_H : PAGE_W}" value="${g.pos}" data-i="${i}">
     <button class="te-gdel" data-del="${i}">✕</button></div>`).join("");
  $$("#teGuideList input").forEach((el) => el.addEventListener("input", () => { teCfg.guides[+el.dataset.i].pos = +el.value; drawTePreview(); }));
  $$("#teGuideList .te-gdel").forEach((el) => el.addEventListener("click", () => { teCfg.guides.splice(+el.dataset.del, 1); renderTeGuides(); drawTePreview(); }));
}
function bindTemplateEditor() {
  $$("#teBase .seg-btn").forEach((el) => el.addEventListener("click", () => {
    teCfg.base = el.dataset.base; $$("#teBase .seg-btn").forEach((b) => b.classList.toggle("on", b === el)); drawTePreview();
  }));
  $("#teSpacing").addEventListener("input", (e) => { teCfg.spacing = +e.target.value; $("#teSpacingVal").textContent = teCfg.spacing; drawTePreview(); });
  $("#tePaper").addEventListener("input", (e) => { teCfg.paperColor = e.target.value; drawTePreview(); });
  $("#teLine").addEventListener("input", (e) => { teCfg.lineColor = e.target.value; drawTePreview(); });
  $("#teGuideColor").addEventListener("input", (e) => { teCfg.guideColor = e.target.value; drawTePreview(); });
  $("#teAddH").addEventListener("click", () => { teCfg.guides.push({ type: "h", pos: Math.round(PAGE_H / 2) }); renderTeGuides(); drawTePreview(); });
  $("#teAddV").addEventListener("click", () => { teCfg.guides.push({ type: "v", pos: Math.round(PAGE_W / 2) }); renderTeGuides(); drawTePreview(); });
  $("#teClearG").addEventListener("click", () => { teCfg.guides = []; renderTeGuides(); drawTePreview(); });
  // 点击预览添加参考线（就近判断加水平还是垂直：取离边更近的方向）
  $("#tePreview").addEventListener("click", (e) => {
    const r = e.target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * PAGE_W, y = (e.clientY - r.top) / r.height * PAGE_H;
    // 竖直优先当点靠近左右，否则水平
    if (Math.min(x, PAGE_W - x) < Math.min(y, PAGE_H - y)) teCfg.guides.push({ type: "v", pos: Math.round(x) });
    else teCfg.guides.push({ type: "h", pos: Math.round(y) });
    renderTeGuides(); drawTePreview();
  });
  $("#teCancel").addEventListener("click", closeTemplateEditor);
  $("#teSave").addEventListener("click", async () => {
    const name = ($("#teName").value || "").trim() || "我的模板";
    const t = { id: await uid(), name, ...teCfg };
    customTemplates.push(t); window.api.updateSettings({ customTemplates });
    closeTemplateEditor(); setTemplate(t.id); toast("模板已创建");
  });
}

// ═══════════ 自定义笔盒（编辑工具盘） ═══════════
let deDraft = null;   // 编辑草稿：[{t, on}]，按显示顺序
function openDockEditor() {
  $("#morePanel").classList.add("hidden");
  // 已在盒里的按当前顺序在前，其余排后
  const inDock = dockTools.filter((t) => toolDef(t));
  const rest = TOOL_REGISTRY.map((d) => d.t).filter((t) => !inDock.includes(t));
  deDraft = inDock.map((t) => ({ t, on: true })).concat(rest.map((t) => ({ t, on: false })));
  renderDeList();
  $("#dockEditor").classList.remove("hidden");
}
function renderDeList() {
  const list = $("#deList");
  list.innerHTML = deDraft.map((row, i) => {
    const d = toolDef(row.t);
    return `<div class="de-row${row.on ? " on" : ""}" data-i="${i}" draggable="true">
      <span class="de-grip">☰</span>
      <span class="de-ico"><svg viewBox="0 0 24 24">${d.svg}</svg></span>
      <span class="de-name">${d.name}</span>
      <button class="de-toggle${row.on ? " on" : ""}" data-toggle="${i}" aria-label="放入笔盒">
        <span class="de-knob"></span></button>
    </div>`;
  }).join("");
  $$("#deList .de-toggle").forEach((el) => el.addEventListener("click", (e) => {
    e.stopPropagation(); const i = +el.dataset.toggle; deDraft[i].on = !deDraft[i].on; renderDeList();
  }));
  $$("#deList .de-row").forEach((el) => bindDeDrag(el));
}
let deDragIdx = null;
function bindDeDrag(el) {
  el.addEventListener("dragstart", () => { deDragIdx = +el.dataset.i; el.classList.add("dragging"); });
  el.addEventListener("dragend", () => { el.classList.remove("dragging"); $$("#deList .de-row").forEach((x) => x.classList.remove("drop-target")); });
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drop-target"); });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    e.preventDefault(); const to = +el.dataset.i;
    if (deDragIdx === null || deDragIdx === to) return;
    const [m] = deDraft.splice(deDragIdx, 1); deDraft.splice(to, 0, m);
    deDragIdx = null; renderDeList();
  });
}
function bindDockEditor() {
  on("#btnEditDock", "click", openDockEditor);
  on("#deCancel", "click", () => $("#dockEditor").classList.add("hidden"));
  on("#deSave", "click", () => {
    dockTools = deDraft.filter((r) => r.on).map((r) => r.t);
    window.api.updateSettings({ dockTools });
    buildDockTools(); $("#dockEditor").classList.add("hidden"); toast("笔盒已更新");
  });
  $("#dockEditor").addEventListener("click", (e) => { if (e.target.id === "dockEditor") $("#dockEditor").classList.add("hidden"); });
}

// ═══════════ 批量编辑笔 ═══════════
let pmeSel = new Set();
function openPenMultiEditor() {
  $("#morePanel").classList.add("hidden");
  pmeSel = new Set([activePen].filter((i) => pens[i]));
  buildPmePalette();
  renderPmePens();
  syncPmeControls();
  $("#penMultiEditor").classList.remove("hidden");
}
function buildPmePalette() {
  const colors = ["#1a1a1a", "#e2453b", "#2f7be6", "#1f9d55", "#f5a623", "#8e44ad", "#d63384", "#00897b"];
  $("#pmePalette").innerHTML = colors.map((c) => `<span class="sw" style="background:${c}" data-c="${c}"></span>`).join("");
  $$("#pmePalette .sw").forEach((el) => el.addEventListener("click", () => { $("#pmeColor").value = el.dataset.c; }));
}
function renderPmePens() {
  const box = $("#pmePens");
  box.innerHTML = pens.map((p, i) => {
    const on = pmeSel.has(i) ? " sel" : "";
    return `<button class="pme-pen${on}" data-i="${i}">${penSVG(p)}<span class="pme-tick">✓</span></button>`;
  }).join("");
  $$("#pmePens .pme-pen").forEach((el) => el.addEventListener("click", () => {
    const i = +el.dataset.i;
    if (pmeSel.has(i)) pmeSel.delete(i); else pmeSel.add(i);
    renderPmePens();
    // 单选时把控件同步到该笔，方便连续快速编辑
    if (pmeSel.size === 1) { const p = pens[[...pmeSel][0]]; if (p) { $("#pmeColor").value = p.color; $("#pmeSize").value = p.size; $("#pmeSizeVal").textContent = p.size; } }
  }));
}
function syncPmeControls() {
  $$("#pmeKind .kind").forEach((el) => el.classList.toggle("on", el.dataset.kind === "keep"));
  const first = pens[[...pmeSel][0]];
  if (first) { $("#pmeColor").value = first.color; $("#pmeSize").value = first.size; $("#pmeSizeVal").textContent = first.size; }
}
function applyPmeToSelected() {
  if (!pmeSel.size) { toast("先选中要修改的笔"); return; }
  const kind = ($("#pmeKind .kind.on")?.dataset.kind) || "keep";
  const col = $("#pmeColor").value, sz = +$("#pmeSize").value;
  for (const i of pmeSel) {
    const p = pens[i]; if (!p) continue;
    if (kind !== "keep") { p.kind = kind; p.tool = kind === "highlighter" ? "highlighter" : "pen"; }
    p.color = col; p.size = sz;
  }
  // 若当前活动笔在选中范围内，同步到工作参数
  if (pmeSel.has(activePen)) { const p = pens[activePen]; color = p.color; size = p.size; penKind = p.kind; tool = p.tool; setColor(color); $("#sizeRange").value = size; $("#sizeVal").textContent = size; selectTool(tool); }
  window.api.updateSettings({ pens }); buildPens(); renderPmePens(); toast(`已更新 ${pmeSel.size} 支笔`);
}
function bindPenMultiEditor() {
  on("#btnMultiEdit", "click", openPenMultiEditor);
  on("#pmeDone", "click", () => $("#penMultiEditor").classList.add("hidden"));
  on("#pmeApply", "click", applyPmeToSelected);
  on("#pmeSelAll", "click", () => { pmeSel = new Set(pens.map((_, i) => i)); renderPmePens(); });
  on("#pmeSize", "input", (e) => $("#pmeSizeVal").textContent = e.target.value);
  on("#pmeColor", "input", () => {});
  $$("#pmeKind .kind").forEach((el) => el.addEventListener("click", () => {
    $$("#pmeKind .kind").forEach((b) => b.classList.toggle("on", b === el));
  }));
  on("#pmeDel", "click", () => {
    if (!pmeSel.size) return;
    if (pens.length - pmeSel.size < 1) { toast("至少保留一支笔"); return; }
    pens = pens.filter((_, i) => !pmeSel.has(i));
    activePen = Math.min(activePen, pens.length - 1);
    pmeSel = new Set(); window.api.updateSettings({ pens, activePen });
    buildPens(); renderPmePens(); toast("已删除选中的笔");
  });
  $("#penMultiEditor").addEventListener("click", (e) => { if (e.target.id === "penMultiEditor") $("#penMultiEditor").classList.add("hidden"); });
}

// ═══════════ 渲染 ═══════════
function renderAll() { applyTransform(); drawPaper(); renderInk(); renderImages(); renderTexts(); renderCovers(); renderCards(); renderThumbs(); const bp = $("#btnBookmarkPage"); if (bp) bp.textContent = curPage().bookmark ? "★" : "☆"; }
function drawPaper() { pctx.clearRect(0, 0, PAGE_W, PAGE_H); paintTemplate(pctx, curPage()); }
function renderInk() { ictx.clearRect(0, 0, PAGE_W, PAGE_H); for (const s of curPage().strokes) strokePath(ictx, s); }
function renderThumbs() {
  if ($("#sidebar").classList.contains("hidden") || drawerMode !== "pages") return;
  const list = $("#pageList");
  list.innerHTML = nb.pages.map((p, i) => `<div class="page-thumb ${i === pageIdx ? "active" : ""}" draggable="true" data-i="${i}"><canvas width="150" height="212"></canvas><span class="num">${i + 1}</span>${p.bookmark ? '<span class="bm">🔖</span>' : ""}${nb.pages.length > 1 ? `<button class="del" data-del="${i}">×</button>` : ""}</div>`).join("");
  $$("#pageList .page-thumb").forEach((el) => {
    const i = +el.dataset.i, c = el.querySelector("canvas"), cx = c.getContext("2d");
    cx.save(); cx.scale(c.width / PAGE_W, c.height / PAGE_H);
    paintTemplate(cx, nb.pages[i]);
    for (const s of nb.pages[i].strokes) strokePath(cx, s);
    for (const im of nb.pages[i].images || []) { const g = getImgObj(im.dataUrl); if (g.complete && g.naturalWidth) cx.drawImage(g, im.x, im.y, im.w, im.h); }
    cx.restore();
    el.addEventListener("click", (e) => { if (e.target.dataset.del != null) return; gotoPage(i); });
    const del = el.querySelector("[data-del]"); if (del) del.addEventListener("click", (e) => { e.stopPropagation(); deletePage(i); });
    bindThumbDrag(el, i);
  });
}
// 页面拖拽重排
let dragIdx = null;
function bindThumbDrag(el, i) {
  el.addEventListener("dragstart", () => { dragIdx = i; el.classList.add("dragging"); });
  el.addEventListener("dragend", () => { el.classList.remove("dragging"); $$(".page-thumb").forEach((x) => x.classList.remove("drop-target")); });
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drop-target"); });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    e.preventDefault(); if (dragIdx === null || dragIdx === i) return;
    const [moved] = nb.pages.splice(dragIdx, 1); nb.pages.splice(i, 0, moved);
    const curId = curPage()?.id; pageIdx = nb.pages.findIndex((p) => p.id === curId);
    dragIdx = null; save(); renderThumbs();
  });
}
function gotoPage(i) {
  closeText(); clearSelection(); pageIdx = i;
  undoStack.length = 0; redoStack.length = 0;
  buildTemplatePicker(); renderAll();
  wrap.classList.remove("turning"); void wrap.offsetWidth; wrap.classList.add("turning");
}

// ═══════════ 页面操作 ═══════════
async function addPage(opts = {}) {
  const id = await uid();
  nb.pages.splice(pageIdx + 1, 0, { id, template: opts.template || curPage().template, bg: opts.bg || null, bookmark: null, strokes: [], texts: [] });
  pageIdx += 1; undoStack.length = 0; redoStack.length = 0;
  save(); renderAll(); if (!opts.silent) toast("已新增页面");
  return curPage();
}
async function deletePage(i) {
  if (nb.pages.length <= 1) return;
  const ok = await modalConfirm({ title: "删除页面", desc: `删除第 ${i + 1} 页？`, okText: "删除", danger: true });
  if (!ok) return;
  bgCache.delete(nb.pages[i].id); nb.pages.splice(i, 1);
  if (pageIdx >= nb.pages.length) pageIdx = nb.pages.length - 1;
  save(); renderAll();
}
async function renameCurrent() { const t = await modalInput({ title: "重命名", value: nb.title, placeholder: "笔记本名称" }); if (t && t.trim()) { nb.title = t.trim(); $("#nbTitle").textContent = nb.title; save(); } }

// ═══════════ undo / redo ═══════════
function snapshot() { return JSON.parse(JSON.stringify(curPage().strokes)); }
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 120) undoStack.shift(); redoStack.length = 0; }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); curPage().strokes = undoStack.pop(); save(); renderInk(); renderThumbs(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); curPage().strokes = redoStack.pop(); save(); renderInk(); renderThumbs(); }

function bindKeys() {
  window.addEventListener("keydown", (e) => {
    if ($("#editor").classList.contains("hidden")) return;
    const editing = e.target.classList?.contains("text-box") || e.target.tagName === "INPUT";
    if (editing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); deleteSelection(); return; }
    // 方向键移动画布
    const step = e.shiftKey ? 200 : 80;
    if (e.key === "ArrowLeft") { e.preventDefault(); panX += step; applyTransform(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); panX -= step; applyTransform(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); panY += step; applyTransform(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); panY -= step; applyTransform(); }
    else if (e.key === "p") usePenTool("pen");
    else if (e.key === "h") usePenTool("highlighter");
    else if (e.key === "e") selectTool("eraser");
    else if (e.key === "v") selectTool("lasso");
    else if (e.key === "t") selectTool("text");
    else if (/^[1-9]$/.test(e.key) && pens[+e.key - 1]) usePen(+e.key - 1);
  });
}
function usePenTool(t) { tool = t; selectTool(t); }

// ═══════════ 持久化 ═══════════
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => window.api.saveNotebooks(state.notebooks), 400); }
function saveNow() { clearTimeout(saveTimer); return window.api.saveNotebooks(state.notebooks); }

// ═══════════ busy / 合成 ═══════════
function busy(on, text) { const b = $("#busy"); if (text) $("#busyText").textContent = text; b.classList.toggle("hidden", !on); }
const imgObjCache = new Map();
function getImgObj(dataUrl) {
  if (imgObjCache.has(dataUrl)) return imgObjCache.get(dataUrl);
  const img = new Image(); img.onload = () => { renderThumbs(); }; img.src = dataUrl;
  imgObjCache.set(dataUrl, img); return img;
}
function flattenPage(i) {
  const c = document.createElement("canvas"); c.width = PAGE_W; c.height = PAGE_H;
  const cx = c.getContext("2d"); paintTemplate(cx, nb.pages[i]);
  for (const s of nb.pages[i].strokes) strokePath(cx, s);
  // 图片对象（截图/导入图片）作为贴在笔记上的对象，浮在笔迹之上
  for (const im of nb.pages[i].images || []) { const g = getImgObj(im.dataUrl); if (g.complete && g.naturalWidth) cx.drawImage(g, im.x, im.y, im.w, im.h); }
  for (const t of nb.pages[i].texts || []) { cx.fillStyle = t.color; cx.font = `${t.size}px sans-serif`; cx.textBaseline = "top"; (t.content || "").split("\n").forEach((ln, k) => cx.fillText(ln, t.x + 4, t.y + 2 + k * t.size * 1.3)); }
  // 卡片（便签）：底色 + 文字
  for (const cd of nb.pages[i].cards || []) {
    cx.fillStyle = cd.color || "#fff4c2"; roundRect(cx, cd.x, cd.y, cd.w, cd.h, 10); cx.fill();
    cx.fillStyle = "#333"; cx.font = "15px sans-serif"; cx.textBaseline = "top";
    (cd.content || "").split("\n").forEach((ln, k) => cx.fillText(ln, cd.x + 10, cd.y + 24 + k * 21));
  }
  return c;
}

// ═══════════ 导出 ═══════════
async function exportRaster(ext) {
  const c = flattenPage(pageIdx);
  const dataUrl = ext === "jpg" ? c.toDataURL("image/jpeg", 0.95) : c.toDataURL("image/png");
  const res = await window.api.exportImage({ dataUrl, ext, suggested: `${nb.title}-第${pageIdx + 1}页.${ext}` });
  if (res.ok) toast(`已导出 ${ext.toUpperCase()}`);
}
async function exportPdf() {
  busy(true, "正在生成 PDF…"); await new Promise((r) => setTimeout(r, 30));
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "px", format: [PAGE_W, PAGE_H] });
    for (let i = 0; i < nb.pages.length; i++) { if (i > 0) doc.addPage([PAGE_W, PAGE_H], "portrait"); doc.addImage(flattenPage(i).toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, PAGE_W, PAGE_H); }
    const res = await window.api.exportPdf({ buffer: doc.output("arraybuffer"), suggested: `${nb.title}.pdf` });
    if (res.ok) toast("已导出 PDF");
  } finally { busy(false); }
}

// ═══════════ 导入 ═══════════
async function importImage() {
  const res = await window.api.importImage(); if (!res.ok) return;
  await placeBg(res.dataUrl); toast("图片已导入");
}
async function placeBg(dataUrl) {
  const target = (curPage().strokes.length || curPage().bg) ? await addPage({ bg: dataUrl, template: "blank", silent: true }) : curPage();
  target.bg = dataUrl; bgCache.delete(target.id); await saveNow(); renderAll();
}
async function importPdf() {
  const res = await window.api.importPdf(); if (!res.ok) return;
  busy(true, "正在解析 PDF…");
  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(res.buffer) }).promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      busy(true, `导入 PDF 第 ${n}/${pdf.numPages} 页…`);
      const page = await pdf.getPage(n), vp0 = page.getViewport({ scale: 1 }), scale = PAGE_W / vp0.width, vp = page.getViewport({ scale });
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const dataUrl = c.toDataURL("image/jpeg", 0.85);
      const empty = !curPage().strokes.length && !curPage().bg;
      const target = (n === 1 && empty) ? curPage() : await addPage({ bg: dataUrl, template: "blank", silent: true });
      target.bg = dataUrl; target.template = "blank"; bgCache.delete(target.id);
    }
    nb.title = res.name || nb.title; $("#nbTitle").textContent = nb.title;
    await saveNow(); gotoPage(0); toast(`已导入 PDF（${pdf.numPages} 页）`);
  } catch (err) { console.error(err); modalAlert({ title: "PDF 导入失败", desc: err.message }); } finally { busy(false); }
}

// ═══════════ .xopp（Xournal++） ═══════════
const XO_W = PAGE_W, XO_H = PAGE_H;
const toHex = (c) => /^#[0-9a-f]{6}$/i.test(c) ? c + "ff" : c;
const fromHex = (c) => /^#[0-9a-f]{8}$/i.test(c) ? c.slice(0, 7) : c;
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function escapeHtml(s) { return esc(s); }

async function exportXopp() {
  await saveNow();
  const out = [`<?xml version="1.0" standalone="no"?>`, `<xournal creator="手写笔记 (Notes Plus clone)" fileversion="4">`, `<title>${esc(nb.title)}</title>`];
  for (const page of nb.pages) {
    const b = baseOf(page.template || "blank");
    out.push(`<page width="${XO_W}" height="${XO_H}">`);
    out.push(`<background type="solid" color="#ffffffff" style="${b === "grid" || b === "cornell" ? "graph" : b === "lined" ? "lined" : "plain"}"/>`);
    out.push(`<layer>`);
    for (const s of page.strokes) {
      const tool = s.tool === "highlighter" ? "highlighter" : "pen";
      const widths = s.points.map((p) => +(s.tool === "highlighter" ? s.size * 3 : Math.max(0.5, s.size * (0.5 + (p.p ?? 0.5)))).toFixed(2));
      out.push(`<stroke tool="${tool}" color="${toHex(s.color)}" width="${widths.join(" ")}">${s.points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")}</stroke>`);
    }
    for (const t of page.texts || []) out.push(`<text font="Sans" size="${t.size}" x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" color="${toHex(t.color)}">${esc(t.content)}</text>`);
    out.push(`</layer></page>`);
  }
  out.push(`</xournal>`);
  const res = await window.api.exportXopp({ xml: out.join("\n"), suggested: `${nb.title}.xopp` });
  if (res.ok) toast("已导出 .xopp");
}
async function importXopp() {
  const res = await window.api.importXopp(); if (!res.ok) return;
  busy(true, "正在解析 .xopp…");
  try {
    const doc = new DOMParser().parseFromString(res.xml, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML 解析失败");
    const pageEls = [...doc.querySelectorAll("page")]; if (!pageEls.length) throw new Error("没有页面");
    const pages = [];
    for (const pe of pageEls) {
      const pw = parseFloat(pe.getAttribute("width")) || XO_W, ph = parseFloat(pe.getAttribute("height")) || XO_H, sx = XO_W / pw, sy = XO_H / ph;
      const bgStyle = pe.querySelector("background")?.getAttribute("style") || "plain";
      const template = bgStyle === "graph" ? "grid" : (bgStyle === "lined" || bgStyle === "ruled") ? "lined" : "blank";
      const strokes = [], texts = [];
      for (const st of pe.querySelectorAll("layer > stroke, stroke")) {
        const nums = st.textContent.trim().split(/\s+/).map(Number).filter((n) => !isNaN(n)), pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i] * sx, y: nums[i + 1] * sy, p: 0.5 });
        if (!pts.length) continue;
        const tl = (st.getAttribute("tool") || "pen") === "highlighter" ? "highlighter" : "pen";
        const widths = (st.getAttribute("width") || "3").trim().split(/\s+/).map(Number), base = widths[0] || 3;
        strokes.push({ tool: tl, color: fromHex(st.getAttribute("color") || "#000000ff"), size: tl === "highlighter" ? Math.max(1, Math.round(base / 3)) : Math.max(1, Math.round(base)), points: pts });
      }
      for (const te of pe.querySelectorAll("layer > text, text")) texts.push({ id: await uid(), x: parseFloat(te.getAttribute("x")) * sx || 40, y: parseFloat(te.getAttribute("y")) * sy || 40, w: 300, content: te.textContent, color: fromHex(te.getAttribute("color") || "#000000ff"), size: parseFloat(te.getAttribute("size")) || 20 });
      pages.push({ id: await uid(), template, bg: null, bookmark: null, strokes, texts });
    }
    nb.pages = pages; nb.title = res.name || nb.title; $("#nbTitle").textContent = nb.title;
    bgCache.clear(); await saveNow(); gotoPage(0); toast(`已导入 .xopp（${pages.length} 页）`);
  } catch (err) { console.error(err); modalAlert({ title: ".xopp 导入失败", desc: err.message }); } finally { busy(false); }
}

// ═══════════ 内嵌小工具：计算器 / 计时器 ═══════════
function makeDraggable(panel, handle) {
  let dragging = false, sx, sy, ox, oy;
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("ma-x")) return;
    dragging = true; const r = panel.getBoundingClientRect();
    panel.style.left = r.left + "px"; panel.style.top = r.top + "px"; panel.style.transform = "none";
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => { if (!dragging) return; panel.style.left = ox + (e.clientX - sx) + "px"; panel.style.top = oy + (e.clientY - sy) + "px"; });
  handle.addEventListener("pointerup", () => { dragging = false; });
}
let calcExpr = "";
function calcRender() { $("#calcScreen").textContent = calcExpr || "0"; }
function calcKey(k) {
  if (k === "C") { calcExpr = ""; }
  else if (k === "←") { calcExpr = calcExpr.slice(0, -1); }
  else if (k === "=") {
    try {
      const safe = calcExpr.replace(/[^0-9+\-*/%.() ]/g, "");
      if (!safe) return;
      let v = Function(`"use strict";return (${safe.replace(/%/g, "/100")})`)();
      if (!isFinite(v)) v = "错误";
      else v = Math.round(v * 1e10) / 1e10;
      calcExpr = String(v);
    } catch { calcExpr = "错误"; }
  } else {
    if (calcExpr === "错误") calcExpr = "";
    calcExpr += k;
  }
  calcRender();
}
let timerMode = "stopwatch", timerRunning = false, timerSec = 0, timerSet = 0, timerInt = 0;
function timerFmt(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
function timerRender() { $("#timerDisplay").textContent = timerFmt(timerMode === "countdown" ? timerSec : timerSec); }
function timerTick() {
  if (timerMode === "countdown") {
    timerSec -= 1;
    if (timerSec <= 0) { timerSec = 0; timerStop(); toast("⏰ 倒计时结束"); }
  } else timerSec += 1;
  timerRender();
}
function timerStart() {
  if (timerRunning) { timerStop(); return; }
  if (timerMode === "countdown" && timerSec <= 0) { toast("请先设置倒计时时长"); return; }
  timerRunning = true; $("#timerStart").textContent = "暂停";
  timerInt = setInterval(timerTick, 1000);
}
function timerStop() { timerRunning = false; clearInterval(timerInt); timerInt = 0; $("#timerStart").textContent = "开始"; }
function timerReset() { timerStop(); timerSec = timerMode === "countdown" ? timerSet : 0; timerRender(); }
function openCalc() { $("#morePanel").classList.add("hidden"); $("#calcPanel").classList.remove("hidden"); calcRender(); }
function openTimer() { $("#morePanel").classList.add("hidden"); $("#timerPanel").classList.remove("hidden"); timerRender(); }
function bindWidgets() {
  on("#btnCalc", "click", openCalc);
  on("#calcClose", "click", () => $("#calcPanel").classList.add("hidden"));
  $$("#calcKeys .ck").forEach((b) => b.addEventListener("click", () => calcKey(b.dataset.k)));
  makeDraggable($("#calcPanel"), $("#calcHead"));

  on("#btnTimer", "click", openTimer);
  on("#timerClose", "click", () => $("#timerPanel").classList.add("hidden"));
  on("#timerStart", "click", timerStart);
  on("#timerReset", "click", timerReset);
  $$("#timerModeSeg .seg-btn").forEach((b) => b.addEventListener("click", () => {
    $$("#timerModeSeg .seg-btn").forEach((x) => x.classList.toggle("on", x === b));
    timerMode = b.dataset.tm; timerStop(); timerSec = 0; timerSet = 0;
    $("#timerSet").classList.toggle("hidden", timerMode !== "countdown");
    timerRender();
  }));
  $$("#timerSet .mini-btn").forEach((b) => b.addEventListener("click", () => {
    timerSet += +b.dataset.add; timerSec = timerSet; timerRender();
  }));
  makeDraggable($("#timerPanel"), $("#timerHead"));
}

// ═══════════ toast ═══════════
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1300); }

// ═══════════ iOS 风模态框 / 菜单（替换原生 prompt/confirm/alert） ═══════════
let _modalCleanup = null;
function _closeModal() {
  const mask = $("#modalMask");
  mask.classList.add("hidden");
  if (_modalCleanup) { document.removeEventListener("keydown", _modalCleanup); _modalCleanup = null; }
}
// 输入型：resolve(字符串) 或 resolve(null) 取消
function modalInput({ title, desc = "", value = "", placeholder = "", okText = "确定", danger = false } = {}) {
  return new Promise((resolve) => {
    const mask = $("#modalMask");
    $("#modalTitle").textContent = title || "";
    $("#modalDesc").textContent = desc || "";
    const inp = $("#modalInput");
    inp.classList.remove("hidden"); inp.value = value; inp.placeholder = placeholder;
    $("#modalSwatches").classList.add("hidden");
    const ok = $("#modalOk"), cancel = $("#modalCancel");
    ok.textContent = okText; ok.classList.toggle("danger", !!danger);
    cancel.classList.remove("hidden");
    mask.classList.remove("hidden");
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = (v) => { _closeModal(); resolve(v); };
    ok.onclick = () => done(inp.value);
    cancel.onclick = () => done(null);
    mask.onclick = (e) => { if (e.target === mask) done(null); };
    _modalCleanup = (e) => { if (e.key === "Enter") { e.preventDefault(); done(inp.value); } else if (e.key === "Escape") { e.preventDefault(); done(null); } };
    document.addEventListener("keydown", _modalCleanup);
  });
}
// 确认型：resolve(true/false)
function modalConfirm({ title, desc = "", okText = "确定", danger = false } = {}) {
  return new Promise((resolve) => {
    const mask = $("#modalMask");
    $("#modalTitle").textContent = title || "";
    $("#modalDesc").textContent = desc || "";
    $("#modalInput").classList.add("hidden");
    $("#modalSwatches").classList.add("hidden");
    const ok = $("#modalOk"), cancel = $("#modalCancel");
    ok.textContent = okText; ok.classList.toggle("danger", !!danger);
    cancel.classList.remove("hidden");
    mask.classList.remove("hidden");
    const done = (v) => { _closeModal(); resolve(v); };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    mask.onclick = (e) => { if (e.target === mask) done(false); };
    _modalCleanup = (e) => { if (e.key === "Enter") { e.preventDefault(); done(true); } else if (e.key === "Escape") { e.preventDefault(); done(false); } };
    document.addEventListener("keydown", _modalCleanup);
  });
}
// 仅提示型：resolve() 一个确定按钮
function modalAlert({ title, desc = "" } = {}) {
  return new Promise((resolve) => {
    const mask = $("#modalMask");
    $("#modalTitle").textContent = title || "";
    $("#modalDesc").textContent = desc || "";
    $("#modalInput").classList.add("hidden");
    $("#modalSwatches").classList.add("hidden");
    const ok = $("#modalOk"), cancel = $("#modalCancel");
    ok.textContent = "好"; ok.classList.remove("danger");
    cancel.classList.add("hidden");
    mask.classList.remove("hidden");
    const done = () => { _closeModal(); resolve(); };
    ok.onclick = done;
    mask.onclick = (e) => { if (e.target === mask) done(); };
    _modalCleanup = (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); done(); } };
    document.addEventListener("keydown", _modalCleanup);
  });
}
// 色块选择型：resolve(颜色值) 或 resolve(null)。custom=true 时附一个自定义取色器
function modalSwatch({ title, desc = "", colors = [], current = "", custom = false } = {}) {
  return new Promise((resolve) => {
    const mask = $("#modalMask");
    $("#modalTitle").textContent = title || "";
    $("#modalDesc").textContent = desc || "";
    $("#modalInput").classList.add("hidden");
    const sw = $("#modalSwatches"); sw.classList.remove("hidden"); sw.innerHTML = "";
    const done = (v) => { _closeModal(); resolve(v); };
    colors.forEach((c) => {
      const b = document.createElement("button");
      b.className = "sw" + (c.toLowerCase() === (current || "").toLowerCase() ? " on" : "");
      b.style.background = c;
      b.onclick = () => done(c);
      sw.appendChild(b);
    });
    if (custom) {
      const wrap = document.createElement("label");
      wrap.className = "sw-custom"; wrap.title = "自定义颜色";
      const inp = document.createElement("input");
      inp.type = "color"; inp.value = /^#[0-9a-f]{6}$/i.test(current) ? current : "#4c8dff";
      inp.oninput = () => { wrap.style.setProperty("--picked", inp.value); };
      inp.onchange = () => done(inp.value);
      wrap.appendChild(inp);
      const plus = document.createElement("span"); plus.className = "sw-plus"; plus.textContent = "＋";
      wrap.appendChild(plus);
      sw.appendChild(wrap);
    }
    const ok = $("#modalOk"), cancel = $("#modalCancel");
    ok.classList.add("hidden"); cancel.classList.remove("hidden"); cancel.textContent = "取消";
    mask.classList.remove("hidden");
    cancel.onclick = () => { ok.classList.remove("hidden"); done(null); };
    mask.onclick = (e) => { if (e.target === mask) { ok.classList.remove("hidden"); done(null); } };
    _modalCleanup = (e) => { if (e.key === "Escape") { e.preventDefault(); ok.classList.remove("hidden"); done(null); } };
    document.addEventListener("keydown", _modalCleanup);
  });
}
// 列表选择型：items=[{id,label,color}] resolve(id) 或 null
function modalList({ title, desc = "", items = [] } = {}) {
  return new Promise((resolve) => {
    const mask = $("#modalMask");
    $("#modalTitle").textContent = title || "";
    $("#modalDesc").textContent = desc || "";
    $("#modalInput").classList.add("hidden");
    const sw = $("#modalSwatches"); sw.classList.remove("hidden"); sw.innerHTML = ""; sw.classList.add("as-list");
    const done = (v) => { sw.classList.remove("as-list"); _closeModal(); resolve(v); };
    items.forEach((it) => {
      const b = document.createElement("button");
      b.className = "list-row";
      b.innerHTML = `<span class="list-dot" style="background:${it.color || "#4c8dff"}"></span>${escapeHtml(it.label)}`;
      b.onclick = () => done(it.id);
      sw.appendChild(b);
    });
    const ok = $("#modalOk"), cancel = $("#modalCancel");
    ok.classList.add("hidden"); cancel.classList.remove("hidden"); cancel.textContent = "取消";
    mask.classList.remove("hidden");
    cancel.onclick = () => { ok.classList.remove("hidden"); done(null); };
    mask.onclick = (e) => { if (e.target === mask) { ok.classList.remove("hidden"); done(null); } };
    _modalCleanup = (e) => { if (e.key === "Escape") { e.preventDefault(); ok.classList.remove("hidden"); done(null); } };
    document.addEventListener("keydown", _modalCleanup);
  });
}
// 浮出小菜单（笔记本 ⋯）：items=[{label,danger,onClick}]，anchor=触发元素
function showCtxMenu(anchor, items) {
  const menu = $("#ctxMenu");
  menu.innerHTML = "";
  items.forEach((it) => {
    const row = document.createElement("button");
    row.className = "ctx-item" + (it.danger ? " danger" : "");
    row.textContent = it.label;
    row.onclick = (e) => { e.stopPropagation(); hideCtxMenu(); it.onClick && it.onClick(); };
    menu.appendChild(row);
  });
  menu.classList.remove("hidden");
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || 160, mh = menu.offsetHeight || 40;
  let left = r.right - mw; if (left < 8) left = 8;
  let top = r.bottom + 6; if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
  menu.style.left = left + "px"; menu.style.top = top + "px";
  setTimeout(() => document.addEventListener("click", hideCtxMenu, { once: true }), 0);
}
function hideCtxMenu() { $("#ctxMenu").classList.add("hidden"); }
const COVER_PALETTE = [
  "#4c8dff", "#0a84ff", "#5856d6", "#8e44ad", "#e2453b", "#ff7a59",
  "#f5a623", "#ffd60a", "#1f9d55", "#16b1c4", "#34c759", "#ff2d55",
  "#8e8e93", "#1c1c1e", "#7d5a3c", "#c77d4a",
];

// ═══════════ 自测探针（仅供 CDP 测试用；无副作用） ═══════════
window.__np_strokes = () => curPage().strokes.map((s) => s.points.length);
window.__np_tool = () => tool;
window.__np_pens = () => pens.map((p) => ({ kind: p.kind, color: p.color, size: p.size }));
window.__np_selInfo = () => {
  if (!sel) return null;
  let x0 = Infinity, y0 = Infinity;
  for (const s of sel.strokes) for (const p of s.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); }
  return { n: sel.strokes.length, x0, y0 };
};
// 擦除探针：把屏幕坐标换算成逻辑坐标，统计线上左/中/右三段是否有笔迹
window.__np_eraseProbe = (mxScreen, x0Screen, x1Screen, yScreen, rect) => {
  const toLx = (sx) => (sx - rect.left) / zoom;
  const midLx = toLx(mxScreen), leftLx = toLx(x0Screen), rightLx = toLx(x1Screen);
  const gap = 4;   // 中点极近处不应再有笔迹（被橡皮挖断）
  let leftKept = false, rightKept = false, middleGone = true;
  const q = Math.min(leftLx, rightLx) + Math.abs(rightLx - leftLx) * 0.25;
  const q3 = Math.min(leftLx, rightLx) + Math.abs(rightLx - leftLx) * 0.75;
  for (const s of curPage().strokes) for (const p of s.points) {
    if (Math.abs(p.x - q) < 40) leftKept = true;
    if (Math.abs(p.x - q3) < 40) rightKept = true;
    if (Math.abs(p.x - midLx) < gap) middleGone = false;
  }
  return { segments: curPage().strokes.length, leftKept, rightKept, middleGone };
};

init();
