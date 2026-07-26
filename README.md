# 手写笔记（Notes Plus 风格）

Windows 10 可运行的矢量手写笔记应用（Electron）。灵感来自 [Notes Plus](https://www.notesplus.com/)。

## 已实现功能

- **拟物笔盘**：钢笔 / 马克笔 / 圆珠笔 / 荧光笔 / 铅笔，底部胶囊真实显示，选中的笔上抬
- **压感手写笔**：线宽随笔压变化（支持数位板/触控笔的 pointer pressure）
- **橡皮擦**：整笔擦除 + 像素擦除（笔尖局部挖除）双模式，可调大小
- **套索选择 + 变换框**：框选后旋转 / 缩放 / 移动 / 改色 / 复制 / 删除
- **自定义模板编辑器**：底纹(空白/横线/网格/点阵) + 密度滑块 + 纸色/线色/参考线色取色 + 添加水平/垂直参考线 + 命名保存
- **书架文件夹**：新建 / 命名 / 改色 / 删除文件夹，拖入或移入笔记本，进入 / 返回
- **笔记本封面**：16 色预设 + 自定义取色器
- **调色板 + 自定义取色 + 笔宽调节（1–24）**
- **撤销 / 重做**（每页独立，Ctrl+Z / Ctrl+Y）
- **多页笔记本**：侧栏页面缩略图，增页 / 删页 / 拖拽重排 / 切页，书签
- **平移缩放**：Ctrl+滚轮缩放，滚轮/拖动手平移，一键适应
- **自动保存**到本地（electron-store）
- **导入 / 导出**：图片、PDF、Xournal++ (.xopp)；当前页 PNG/JPG、整本 PDF
- 快捷键：`P` 钢笔 / `H` 荧光笔 / `E` 橡皮 / `V` 套索 / `T` 文字 / `1–9` 切笔

## 与商业版 Notes Plus 的差距（暂未包含）

手写转文字 OCR、录音同步、AI 相关能力。这些需要专门模型/大量工程，属于后续增量。

## 运行（开发）

```bash
npm install
npm start
```

## 打成 Windows exe

在 Windows x64 上：

```bash
npm install
npm run dist:win   # 产物在 release/：便携 exe + 免安装 zip
```

或用本仓库的 GitHub Actions：**Actions → Build Windows exe → Run workflow**，完成后在 Artifacts 下载。打 tag（`git tag v1.2.0 && git push origin v1.2.0`）会自动发 Release。

### 下载建议

Release 提供两种 Windows 产物：

- **推荐 `NotesPlus-win-x64-*.zip`（免安装解压版）**：解压后双击「手写笔记.exe」运行，解压即用、不依赖自解压、绝不会缺 ffmpeg.dll。
- `NotesPlus-portable-*.exe`（单文件便携版）：双击即用；个别机器若因杀毒拦截/临时目录问题导致自解压不完整而报错，请改用 zip 版。
