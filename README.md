# 手写笔记（Notes Plus 风格）

Windows 10 可运行的矢量手写笔记应用（Electron）。灵感来自 [Notes Plus](https://www.notesplus.com/)。

## 已实现功能

- **压感手写笔**：线宽随笔压变化（支持数位板/触控笔的 pointer pressure）
- **荧光笔**：半透明叠加
- **橡皮擦**：按整条笔画擦除
- **调色板 + 自定义取色 + 笔宽调节（1–24）**
- **撤销 / 重做**（每页独立，Ctrl+Z / Ctrl+Y）
- **多页笔记本**：侧栏页面缩略图，增页 / 删页 / 切页
- **纸张模板**：空白 / 横线 / 网格
- **平移缩放**：Ctrl+滚轮缩放，滚轮/拖动手平移，一键适应
- **自动保存**到本地（electron-store）
- **导出**：当前页 PNG、整本 PDF
- 快捷键：`P` 钢笔 / `H` 荧光笔 / `E` 橡皮

## 与商业版 Notes Plus 的差距（v1 暂未包含）

手写转文字 OCR、形状自动识别、录音同步、PDF 导入批注、放大镜书写栏。这些需要专门模型/大量工程，属于后续增量。

## 运行（开发）

```bash
npm install
npm start
```

## 打成 Windows exe

在 Windows x64 上：

```bash
npm install
npm run dist:win   # 产物在 release/：安装版 + 便携版
```

或用本仓库的 GitHub Actions：**Actions → Build Windows exe → Run workflow**，完成后在 Artifacts 下载。打 tag（`git tag v1.0.0 && git push origin v1.0.0`）会自动发 Release。
