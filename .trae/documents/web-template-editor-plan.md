# Web Template Editor 实施方案

## Context（背景与目标）

用户从零启动一个桌面端网页模板编辑器项目（工作目录 `f:\Web Modifier`，当前为空）。目标：通过可视化方式在已有网页模板上直接编辑，加快网页开发效率。模板代码用标记标识可修改片段，编辑器解析后用组件化方式呈现，导出时剥离标记、输出干净 HTML 到 `templates/` 之外的 `exports/` 子文件夹。

已与用户确认的关键决策：

* **标记方式**：HTML 注释 `<!-- @wt:edit name="..." type="..." -->...<!-- /@wt:edit -->`（块级）+ `data-wt-edit="..."` 属性（单元素）

* **文件格式**：轻量 sidecar 配置 `config.wt.json`，描述可编辑区段元数据

* **技术栈**：由我决定（已选定见下）

## 技术栈

| 维度      | 选型                                       | 理由                                                                                    |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| 桌面框架    | **Electron**                             | 渲染器与最终 HTML 同 Chromium，保真度是此类工具硬需求；Tauri 的系统 WebView（Win=WebView2/mac=WebKit）与部署环境不一致 |
| 构建      | **Vite + electron-vite**                 | renderer/main/preload 三端统一 HMR                                                        |
| UI      | **React 18 + TypeScript**                | 组件生态成熟                                                                                |
| 样式      | **Tailwind CSS**                         | 一致性 + 动画支持                                                                            |
| 动画      | **Framer Motion**                        | 用户明确重视动画流畅度                                                                           |
| 状态      | **Zustand**                              | 轻量                                                                                    |
| HTML 解析 | **cheerio**（仅用于发现区域 + 锚点 ID 注入，不用于导出序列化） | 见下「导出安全」                                                                              |
| 打包      | **electron-builder**                     | 跨平台                                                                                   |

## 三大架构铁律（来自 Plan 代理审查）

1. **必须用自定义协议** **`wt-template://<name>/...`** **替代 iframe** **`srcdoc`**。原因：srcdoc 无法解析模板相对资产路径（`assets/hero.jpg`），且无同源，postMessage 通信复杂。自定义协议在主进程 session 上注册，直接服务 `templates/` 文件夹，一次性解决资产路径、同源、HTML 改写注入三件事。
2. **导出时不能用 cheerio 序列化**。原因：cheerio 会塌陷空白、重排属性，破坏开发者原 HTML 格式。导出器改用「cheerio 发现区域 → 在原串上按字节 offset 做外科手术式剥离 + 值替换」。
3. **iframe 内必须监听 scroll/resize 主动重广播 rects**。否则父端覆盖层会与实际节点漂移错位，体验崩塌。

## 项目结构

```
f:\Web Modifier\
  package.json
  tsconfig.json
  vite.config.ts / electron.vite.config.ts
  electron/
    main/
      main.ts                          # 主进程入口、窗口、协议注册
      protocol/
        template-protocol.ts          # wt-template:// 服务 templates/
        temp-protocol.ts              # wt-temp:// 服务 session 临时资产
      services/
        marker-parser.ts              # 解析 HTML → Region[]，注入 data-wt-rid
        exporter.ts                    # 原串剥离 + 值替换
        template-manager.ts           # 模板列表/导入/打开
      ipc/
        template.ts                    # parseTemplate / exportTemplate / listTemplates
        file.ts                        # 普通文件 IPC
    preload/
      preload.ts                       # contextBridge API 表
  shared/                              # main 与 renderer 共享
    types/
      region.ts                        # Region / EditableType / WTConfig 类型
      ipc.ts                           # IPC 通道名 + 参数/返回契约
  src/                                  # Renderer (React)
    App.tsx, main.tsx, index.css
    components/
      TopBar/TopBar.tsx                # 导入/导出/保存
      Sidebar/TemplateList.tsx         # 模板列表
      Editor/
        IframeViewport.tsx             # iframe 容器 + 注入脚本 + postMessage
        RegionOverlay.tsx              # 高亮覆盖层
        PropertyPanel.tsx              # 区段属性表单
      Common/                          # 通用 UI
    store/
      template-store.ts                # Zustand：当前模板、Region[]、当前选中
    lib/
      inject-script.ts                 # 注入到 iframe 的脚本（rect 广播 + update 应用）
  templates/                           # 内置模板
    hello/
      index.html                       # 含 1 个 text 区域的极简样例
      config.wt.json
  exports/                              # 用户导出（在 templates/ 之外）
  .trae/documents/web-template-editor-plan.md
```

## 标记语法规范

### 块级注释标记

```html
<!-- @wt:edit name="hero-title" type="text" label="主标题" -->
<h1>欢迎来到产品主页</h1>
<!-- /@wt:edit -->
```

### 单元素属性标记

```html
<h1 data-wt-edit="title-only" data-wt-type="text">短标题</h1>
```

### 支持的可编辑类型

`text` | `richtext` | `image` | `link` | `color` | `list` | `html`

### config.wt.json 结构

```json
{
  "name": "Hello Template",
  "version": "1.0.0",
  "editable": {
    "hero-title": {
      "type": "text",
      "label": "主标题",
      "default": "欢迎来到产品主页",
      "validation": { "maxLength": 50 }
    }
  }
}
```

## 统一数据模型

```ts
type EditableType = 'text' | 'richtext' | 'image' | 'link' | 'color' | 'list' | 'html';

interface Region {
  id: string;                       // name from marker
  kind: 'block' | 'attr';           // 注释块 vs 单元素属性
  type: EditableType;
  label?: string;
  anchorRids: string[];             // 区域内所有节点注入的 data-wt-rid
  value: string;                    // 当前值
  byteRange?: { start: number; end: number };  // 在原 HTML 中的字节区间（导出用）
}
```

块标记与属性标记在数据层统一为 `Region`，渲染层只关心 `anchorRids + type`。

## 编辑流水线

1. 用户选模板 → 主进程读 `templates/<name>/index.html` + `config.wt.json`
2. `marker-parser.ts` 用 cheerio 找区域，给区域内每个节点注入 `data-wt-rid="<id>"`，重序列化（仅用于显示，不用于导出）
3. renderer 把改写后的 HTML 通过 `wt-template://` 协议载入 iframe
4. iframe 内注入脚本：`ResizeObserver` + scroll 监听 → postMessage rects 给父端
5. `RegionOverlay` 用 rects 画高亮框；点击 → `PropertyPanel` 显示该 type 的表单
6. 用户改值 → state 更新 → 父端 postMessage `{op:'update', rid, type, value}` 给 iframe → iframe 内脚本按 rid 定向改 `textContent`/`src`/`innerHTML`（**不做全量重注入**，保住滚动位置和焦点）
7. 导出 → 主进程读**原始** HTML（无注入），用 Region 的 `byteRange` 在原串上剥离注释标记 + 写入新值，写到 `exports/<name>/index.html`，资产复制到 `exports/<name>/assets/`

## 实施阶段

### Phase 0 — 脚手架（最小可启动）

* `package.json`、`electron.vite.config.ts`、`tsconfig.json`

* 主进程入口、preload、空 `App.tsx`

* 注册 `wt-template://` 协议

* `templates/hello/index.html`（含 1 个 text 块标记）+ `config.wt.json`

* 目标：`pnpm dev` 能开窗口并显示 hello 模板

### Phase 1 — 垂直切片（端到端 1 个 text 区域）

* `shared/types/region.ts`、`shared/types/ipc.ts`

* `marker-parser.ts`（仅块注释 + text）

* `exporter.ts`（原串剥离 + 值替换）

* `electron/main/ipc/template.ts`：`parseTemplate` / `exportTemplate`

* `IframeViewport.tsx`：iframe + 注入脚本 + postMessage 收发

* `RegionOverlay.tsx`：rects 高亮 + 点击选中

* `PropertyPanel.tsx`：单 text 输入框 → 定向 update

* `store/template-store.ts`：当前模板、regions、selectedId

* 目标：选 hello → 看到高亮 → 改文本 → iframe 实时变 → 导出干净 HTML

### Phase 2 — 类型扩展

* `image`/`link`/`color`/`richtext`/`list`/`html` 类型编辑器

* `wt-temp://` 临时资产协议

* 资产管理：新图片复制到 session temp，导出时迁到 `exports/<name>/assets/`

### Phase 3 — 模板管理

* `Sidebar/TemplateList.tsx`：列模板、导入（拷贝文件夹到 `templates/`）

* 多个内置模板（landing、blog、portfolio）

### Phase 4 — config.wt.json 完整化

* 元数据驱动表单生成、默认值、校验规则

### Phase 5 — 完善

* 撤销/重做（state history）

* 保存（写回 `templates/<name>/index.html`，可选）

* Framer Motion 过渡动画

* 错误恢复、空态

## 验证方案

每个 Phase 结束时的端到端验证：

**Phase 0**：`pnpm dev` 启动，窗口打开，iframe 内显示 hello 模板的 `<h1>`。

**Phase 1**：

1. 启动应用，左侧选 hello 模板
2. iframe 内出现 1 个高亮框覆盖 `<h1>`
3. 点击高亮 → 右侧 PropertyPanel 出现 text 输入框，预填「欢迎来到产品主页」
4. 改为「测试标题」→ iframe 内 `<h1>` 实时更新且滚动位置不丢
5. 顶部「导出」→ 选目标目录（默认 `exports/hello/`）
6. 打开 `exports/hello/index.html`：**不含任何** **`<!-- @wt:edit -->`** **与** **`data-wt-*`**，且 `<h1>` 内容是「测试标题」
7. 原模板 `templates/hello/index.html` 保持不变（含标记）

**Phase 2-5**：按对应类型手动验证；导出文件用浏览器直接打开应渲染正常。

## 关键文件清单（Phase 0 + 1 优先）

* `f:\Web Modifier\package.json`

* `f:\Web Modifier\electron\main\main.ts`

* `f:\Web Modifier\electron\main\protocol\template-protocol.ts`

* `f:\Web Modifier\electron\main\services\marker-parser.ts`

* `f:\Web Modifier\electron\main\services\exporter.ts`

* `f:\Web Modifier\electron\main\ipc\template.ts`

* `f:\Web Modifier\electron\preload\preload.ts`

* `f:\Web Modifier\shared\types\region.ts`

* `f:\Web Modifier\shared\types\ipc.ts`

* `f:\Web Modifier\src\components\Editor\IframeViewport.tsx`

* `f:\Web Modifier\src\components\Editor\RegionOverlay.tsx`

* `f:\Web Modifier\src\components\Editor\PropertyPanel.tsx`

* `f:\Web Modifier\src\store\template-store.ts`

* `f:\Web Modifier\templates\hello\index.html`

* `f:\Web Modifier\templates\hello\config.wt.json`

