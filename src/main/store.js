const Store = require("electron-store");

// 一个 notebook = { id, title, pages:[ page ] }
// page = { id, paper:'blank'|'lined'|'grid', strokes:[ stroke ] }
// stroke = { tool:'pen'|'highlighter'|'eraser', color, size, points:[{x,y,p}] }
// 坐标以“页面逻辑坐标”存储（与缩放/平移无关），保证缩放后重绘不失真。
const store = new Store({
  name: "notes-plus-data",
  defaults: {
    notebooks: [],
    activeNotebook: null,
    settings: {
      lastTool: "pen",
      lastColor: "#1a1a1a",
      lastSize: 3,
    },
  },
});

module.exports = store;
