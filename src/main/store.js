const Store = require("electron-store");

// 一个 notebook = { id, title, pages:[ page ] }
// page = { id, paper:'blank'|'lined'|'grid', bg:dataUrl|null, strokes:[ stroke ] }
// stroke = { tool:'pen'|'highlighter'|'eraser', color, size, points:[{x,y,p}] }
// bg = 整页背景图（导入 PDF/图片时用），存 dataURL，绘在墨迹之下。
// 坐标以“页面逻辑坐标”存储（与缩放/平移无关），保证缩放后重绘不失真。
// pen = { color, size, tool:'pen'|'highlighter' } —— 笔盘里的一支预设笔。
const store = new Store({
  name: "notes-plus-data",
  defaults: {
    notebooks: [],
    activeNotebook: null,
    settings: {
      lastTool: "pen",
      lastColor: "#1a1a1a",
      lastSize: 3,
      activePen: 0,
      pens: [
        { tool: "pen", color: "#1a1a1a", size: 3 },
        { tool: "pen", color: "#e23b3b", size: 3 },
        { tool: "pen", color: "#2f7be6", size: 4 },
        { tool: "highlighter", color: "#f5d90a", size: 6 },
      ],
    },
  },
});

module.exports = store;
