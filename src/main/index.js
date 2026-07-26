const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
