const Store = require("electron-store");

// ── 数据模型 ──────────────────────────────────────────────
// notebook = { id, title, cover, createdAt, pages:[ page ] }
// page     = { id, template, bg:dataUrl|null, bookmark:null|string,
//              strokes:[ stroke ], texts:[ text ] }
// stroke   = { tool:'pen'|'highlighter', color, size, points:[{x,y,p}] }
// text     = { id, x, y, w, content, color, size }
// template = 'blank'|'lined'|'grid'|'cornell'|<自定义 id>
// bg       = 整页背景图（导入 PDF/图片时用），存 dataURL，绘在墨迹之下。
// 坐标以“页面逻辑坐标”存储（与缩放/平移无关），保证缩放后重绘不失真。
// pen      = { tool, color, size } —— 笔盘里的一支预设笔。
// customTemplate = { id, name, base:'blank'|'lined'|'grid'|'cornell' } —— 自创模板。
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
        { tool: "pen", color: "#e2453b", size: 3 },
        { tool: "pen", color: "#2f7be6", size: 4 },
        { tool: "highlighter", color: "#f5d90a", size: 6 },
      ],
      customTemplates: [],
    },
  },
});

module.exports = store;
