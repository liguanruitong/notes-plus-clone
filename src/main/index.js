const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");
const store = require("./store");

let win = null;
const uid = () => crypto.randomUUID();

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    autoHideMenuBar: true,
    backgroundColor: "#20222a",
    title: "手写笔记",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

// 首次启动给一个空笔记本
function ensureNotebook() {
  let notebooks = store.get("notebooks");
  if (!notebooks.length) {
    const nb = {
      id: uid(),
      title: "我的笔记本",
      pages: [{ id: uid(), paper: "lined", strokes: [] }],
    };
    notebooks = [nb];
    store.set("notebooks", notebooks);
    store.set("activeNotebook", nb.id);
  }
  if (!store.get("activeNotebook")) store.set("activeNotebook", notebooks[0].id);
  return notebooks;
}

// ---- IPC：数据 ----
ipcMain.handle("get-state", () => ({
  notebooks: ensureNotebook(),
  activeNotebook: store.get("activeNotebook"),
  settings: store.get("settings"),
}));

ipcMain.handle("save-notebooks", (_e, notebooks) => { store.set("notebooks", notebooks); return true; });
ipcMain.handle("set-active", (_e, id) => { store.set("activeNotebook", id); return true; });
ipcMain.handle("update-settings", (_e, patch) => {
  const s = { ...store.get("settings"), ...patch };
  store.set("settings", s);
  return s;
});

ipcMain.handle("new-id", () => uid());

// ---- 导出 ----
ipcMain.handle("export-png", async (_e, { dataUrl, suggested }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggested || "note.png",
    filters: [{ name: "PNG 图片", extensions: ["png"] }],
  });
  if (canceled || !filePath) return { ok: false };
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
  return { ok: true, filePath };
});

// 整本 PDF：renderer 生成好 jsPDF 的 arraybuffer 传过来
ipcMain.handle("export-pdf", async (_e, { buffer, suggested }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggested || "notebook.pdf",
    filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return { ok: true, filePath };
});

// ---- 导入 ----
const readAsDataUrl = (filePath, mime) =>
  `data:${mime};base64,` + fs.readFileSync(filePath).toString("base64");

// 导入图片：返回 dataURL，renderer 决定贴到当前页
ipcMain.handle("import-image", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "bmp", "webp"] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  const ext = path.extname(filePaths[0]).slice(1).toLowerCase();
  const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return { ok: true, dataUrl: readAsDataUrl(filePaths[0], mime) };
});

// 导入 PDF：把原始字节交给 renderer（用 pdf.js 逐页栅格化）
ipcMain.handle("import-pdf", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  const buf = fs.readFileSync(filePaths[0]);
  const name = path.basename(filePaths[0], path.extname(filePaths[0]));
  return { ok: true, name, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});

// 导出图片：dataUrl -> 文件（png / jpg）
ipcMain.handle("export-image", async (_e, { dataUrl, suggested, ext }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggested || `note.${ext}`,
    filters: [{ name: ext.toUpperCase() + " 图片", extensions: [ext] }],
  });
  if (canceled || !filePath) return { ok: false };
  const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
  return { ok: true, filePath };
});

// ---- .xopp（Xournal++）：主进程负责 gzip 编解码 ----
ipcMain.handle("import-xopp", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Xournal++ 笔记", extensions: ["xopp", "xoj"] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  const raw = fs.readFileSync(filePaths[0]);
  // xopp 是 gzip；老 xoj 也是 gzip；万一是明文 XML 就直接用
  let xml;
  try { xml = zlib.gunzipSync(raw).toString("utf8"); }
  catch { xml = raw.toString("utf8"); }
  const name = path.basename(filePaths[0], path.extname(filePaths[0]));
  return { ok: true, name, xml };
});

ipcMain.handle("export-xopp", async (_e, { xml, suggested }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggested || "notebook.xopp",
    filters: [{ name: "Xournal++ 笔记", extensions: ["xopp"] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, zlib.gzipSync(Buffer.from(xml, "utf8")));
  return { ok: true, filePath };
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
