# 资产标签生成器

<p align="center">
  <img src="logo/logo.png" alt="HGTECH" width="200">
</p>

基于 NW.js 的桌面端资产标签批量生成工具，支持从 Excel / CSV / 文本导入资产数据，自动生成带二维码的资产标签，并可导出 PDF 用于打印。适用于企业固定资产、设备台账的标签化管理。

## 功能特性

- **多源数据导入**：支持 `.xlsx` / `.xls` Excel 文件、`.csv` / `.txt` 文本文件，以及直接在文本框粘贴录入；内置 Excel 模板下载
- **二维码生成**：根据资产编码自动生成二维码，支持纠错级别（L/M/Q/H）、模块间隙、静默区等参数配置
- **标签可视化编辑**：拖拽定位元素、调整字号 / 字重、Logo 尺寸调整、智能对齐辅助线
- **PDF 批量导出**：基于 Canvas 2D 直绘标签（替代 html2canvas，性能提升 50-100 倍），支持分批处理与进度展示
- **大数据量支持**：虚拟滚动渲染，万条数据流畅预览；支持搜索、排序、批量编辑、部分选择导出
- **数据持久化**：基于 localStorage 的防抖自动保存，关闭后重新打开数据不丢失
- **CSV 导出**：可将当前数据导出为 CSV 文件
- **标签样式可定制**：公司名称、标签尺寸、字段顺序、二维码参数、Logo 等均可通过设置面板调整

## 技术栈

- **运行时**：[NW.js](https://nwjs.io/)（Node-Webkit）桌面运行时
- **前端**：原生 HTML / CSS / JavaScript（无框架）
- **第三方库**：
  - [qrcode.js](https://github.com/davidshimjs/qrcodejs) — 二维码生成
  - [jsPDF](https://github.com/parallax/jsPDF) — PDF 生成
  - [SheetJS (xlsx)](https://github.com/SheetJS/sheetjs) — Excel 读写

## 项目结构

```
.
├── 标签打印.html          # 应用入口（NW.js main）
├── package.json           # NW.js 应用配置（窗口标题、尺寸等）
├── css/
│   └── style.css          # 全局样式
├── js/
│   ├── config.js          # 应用配置（标签尺寸、字段、字体等集中管理）
│   ├── storage.js         # localStorage 持久化（含防抖自动保存）
│   ├── parser.js          # 数据解析与校验（Excel/文本/CSV/日期格式化）
│   ├── qrcode-gen.js      # 二维码生成
│   ├── ui.js              # 通用 UI 组件（toast、confirm 等）
│   ├── logo-store.js      # Logo 来源管理
│   ├── pdf-generator.js   # PDF 生成（Canvas 2D 直绘）
│   ├── settings.js        # 标签模板设置面板
│   ├── label-editor.js   # 标签可视化编辑器（拖拽、对齐辅助）
│   └── app.js             # 主应用逻辑（数据管理、事件绑定）
├── libs/                  # 第三方库（qrcode / jspdf / xlsx）
├── logo/                  # 默认 Logo 图片
├── locales/               # NW.js 多语言资源（zh-CN / zh-TW / en-US / en-GB）
├── swiftshader/           # 软件渲染后端（无 GPU 环境备用）
├── nw.exe                 # NW.js 主程序
├── nw.dll                 # NW.js 核心库（通过 Git LFS 管理，>100MB）
├── node.dll               # Node.js 运行时
└── ...                    # 其他 NW.js 运行时依赖
```

## 快速开始

### 运行环境

- Windows 操作系统（程序为 PE32+ 可执行文件）
- 仓库已包含完整的 NW.js 运行时，**无需额外安装任何依赖**

### 启动方式

1. 克隆仓库（`nw.dll` 通过 Git LFS 管理，需先安装 LFS）：

   ```bash
   # 首次使用前安装 Git LFS
   git lfs install

   git clone https://github.com/Huyx-oswald/FixedassetlabelV2.0.git
   cd FixedassetlabelV2.0
   git lfs pull    # 拉取 nw.dll 等大文件实际内容
   ```

2. 双击目录中的 `nw.exe` 启动程序。

> ⚠️ **重要**：必须通过 `nw.exe` 启动，请勿用浏览器直接打开 `标签打印.html`。非 NW.js 环境下会触发环境守卫拦截——数据存储隔离、Logo 文件读写等功能将无法正常工作。

启动后直接进入主界面，无需登录。上次未保存的数据会自动恢复。

## 使用指南

### 数据录入

支持三种方式：

| 方式 | 说明 |
|------|------|
| 粘贴文本 | 在数据输入框直接粘贴，每行一条记录，字段间用制表符 / 空格 / 逗号分隔 |
| 导入文件 | 点击「导入」或按 `Ctrl+O`，支持 `.xlsx` / `.xls` / `.csv` / `.txt`；Excel 导入时支持字段映射 |
| 下载模板 | 下载 Excel 模板，按格式填写后导入 |

### 资产字段

默认字段（可在 `js/config.js` 或设置面板中调整）：

| 字段 | key | 是否必填 |
|------|-----|---------|
| 资产编码 | `code` | ✅ |
| 资产名称 | `name` | ✅ |
| 使用部门 | `dept` | |
| 规格型号 | `model` | |
| 开始使用日期 | `date` | |
| 责任人 | `person` | |

### 生成与导出

1. 录入数据后点击「生成预览」查看标签效果（或按 `Ctrl+Enter`）
2. 可在预览区**勾选部分记录**仅导出选中项，或直接导出全部
3. 点击「下载 PDF」生成 PDF（或按 `Ctrl+S`），支持进度展示
4. 点击「导出 CSV」导出当前数据（或按 `Ctrl+E`）

### 标签编辑

- 在设置面板中可进入**标签可视化编辑器**：拖拽元素定位、调整字号 / 字重、Logo 尺寸
- 编辑过程显示智能对齐辅助线，便于精确排版

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + Enter` | 生成预览 |
| `Ctrl + S` | 下载 PDF |
| `Ctrl + O` | 导入文件 |
| `Ctrl + E` | 导出 CSV |

## 配置说明

所有可定制参数集中在 [js/config.js](js/config.js)，主要包括：

- `companyName` — 公司名称
- `labelWidth` / `labelHeight` — 标签尺寸（毫米）
- `qrSize` / `qrErrorLevel` / `qrModuleGap` / `qrQuietZone` — 二维码参数
- `fields` / `fieldOrder` / `fieldKeys` — 字段定义与显示顺序
- `requiredFields` — 必填字段（数据校验）
- `validation` — 各字段长度限制
- `fonts` / `defaultFont` — 可选字体清单
- `pdf` — PDF 生成参数（质量、分批大小、Canvas 缩放、超量提醒阈值）

> 用户在设置面板中的修改会保存到 localStorage，运行时覆盖 `config.js` 的默认值，无需改代码即可调整。

## 关于 nw.dll

`nw.dll` 是 NW.js 的核心库（约 175MB），因体积超过 GitHub 普通文件 100MB 限制，通过 **Git LFS** 管理。

- 克隆前请确保已安装 [Git LFS](https://git-lfs.com/)
- 克隆后若 `nw.dll` 仅为指针文件，执行 `git lfs pull` 拉取实际内容
- GitHub 免费账户 LFS 存储 / 带宽配额各 1GB / 月，请注意余量

## 开发说明

代码采用 IIFE 模块化组织（`var Module = (function(){...})()`），各模块职责清晰：

- **数据流**：`Parser` 解析 → `App` 管理 → `LabelEditor` / `PDFGenerator` 渲染
- **持久化**：`Storage` 封装 localStorage，`App` 通过防抖自动保存
- **配置**：`config.js` 定义默认值，`Settings` 加载用户覆盖项

修改标签样式、字段、尺寸等，编辑 [js/config.js](js/config.js) 即可。
