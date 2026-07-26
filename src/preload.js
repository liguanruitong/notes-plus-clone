const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getState: () => ipcRenderer.invoke("get-state"),
  saveNotebooks: (nbs) => ipcRenderer.invoke("save-notebooks", nbs),
  setActive: (id) => ipcRenderer.invoke("set-active", id),
  updateSettings: (patch) => ipcRenderer.invoke("update-settings", patch),
  newId: () => ipcRenderer.invoke("new-id"),
  exportPng: (payload) => ipcRenderer.invoke("export-png", payload),
  exportPdf: (payload) => ipcRenderer.invoke("export-pdf", payload),
  exportImage: (payload) => ipcRenderer.invoke("export-image", payload),
  importImage: () => ipcRenderer.invoke("import-image"),
  importPdf: () => ipcRenderer.invoke("import-pdf"),
  importXopp: () => ipcRenderer.invoke("import-xopp"),
  exportXopp: (payload) => ipcRenderer.invoke("export-xopp", payload),
});
