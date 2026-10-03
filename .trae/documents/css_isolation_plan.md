# CSS 项目隔离 实施计划

## 背景与调研结论

**现状问题**：可视化 CSS 编辑（样式面板）经 500ms 防抖直接 `writeCssFile` 写回模板目录内的 CSS 文件（如 `style.css`），即**永久修改模板本体**。而文字/图片等 region 编辑只以差异形式存于项目草稿，不动模板。后果：

- 同一模板的多个项目草稿共享一份被改过的 CSS，互相串改；
- 打开任一草稿看到的都是"最后一次 CSS 编辑"，无法各自独立；
- CSS 编辑不在草稿里，删模板/恢复快照才是唯一回滚手段。

**关键链路（已确认）**：
- 渲染层 [template-store.ts](file:///f:/Web%20Modifier/src/store/template-store.ts)：`cssFiles/cssCurrentFile/cssBlocks`（仅当前打开的一个 CSS 文件在内存）、`scheduleCssPersist()` 防抖写盘、`flushCss()` 强制写盘（导出/切模板/页面改名删除/回主页/关窗前调用）、`collectProjectEdits()` 只收 region 差异、自动草稿 `persistAutosave()` 只存 region edits。
- 预览：iframe 经 `wt-template://` 协议从磁盘加载页面与 `<link>` 样式表；编辑中的当前 CSS 文件通过注入 `<style id="wt-custom-css">` 覆盖（[inject-script.ts](file:///f:/Web%20Modifier/shared/inject-script.ts) `wt-css-update`），iframe 重载时 [IframeViewport.tsx](file:///f:/Web%20Modifier/src/components/Editor/IframeViewport.tsx#L85-L88) 只重放当前文件。
- 主进程 [css-parser.ts](file:///f:/Web%20Modifier/electron/main/services/css-parser.ts)：list/read/write；`readCssFile` 返回 `{blocks, cssText}`。
- 草稿 [project-manager.ts](file:///f:/Web%20Modifier/electron/main/services/project-manager.ts)：`ProjectFile.edits`（页→region→值），自动草稿同构。
- 导出 [ipc/template.ts](file:///f:/Web%20Modifier/electron/main/ipc/template.ts#L126-L169)：整目录拷贝模板磁盘文件 → 用 region 值覆盖 HTML。CSS 目前靠"已写盘"进导出。
- 页面目录移动/删除（rename/delete page）会带动目录内 CSS（导入页面把源模板 CSS 带进子目录），store 已有 `reloadAfterStructure` 重扫 CSS 文件列表。

**方案核心**：CSS 编辑与 region 编辑同构——**永不写模板磁盘**；会话内维护"每 CSS 文件覆盖文本"，差异随项目/自动草稿持久化；预览注入全部覆盖文件；导出时把覆盖写入导出副本。旧草稿无 `cssEdits` 字段时按无 CSS 差异处理（旧版本 CSS 已落盘，天然兼容）。

## 改动文件与模块

### 共享类型
- [shared/types/ipc.ts](file:///f:/Web%20Modifier/shared/types/ipc.ts)
  - 新增 `export type CssEdits = Record<string, string>`（key=CSS 文件相对模板根 POSIX 路径，value=完整 CSS 文本）。
  - `ProjectMeta` 增 `cssCount?: number`；`SaveProjectArgs`、`ReadProjectResult` 增 `cssEdits?: CssEdits`；`SaveAutosaveArgs`、`GetAutosaveResult` 增 `cssEdits?`；`AutosaveMeta` 增 `cssCount?`；`ExportTemplateArgs` 增 `cssEdits?: CssEdits`。
- [project-manager.ts](file:///f:/Web%20Modifier/electron/main/services/project-manager.ts)：`ProjectFile` 增 `cssEdits?`；save 透传；`listProjects`/`getAutosave` 的 meta 带 `cssCount = Object.keys(cssEdits||{}).length`。

### 主进程
- [ipc/template.ts](file:///f:/Web%20Modifier/electron/main/ipc/template.ts)
  - 导出：copyAssets 后，遍历 `cssEdits`，路径校验（`.css` 后缀 + resolve 后必须在 exportDir 内），用现有 `overwriteFile` 覆盖导出副本中的 CSS。
  - 删除 `WRITE_CSS_FILE` handler。
- [css-parser.ts](file:///f:/Web%20Modifier/electron/main/services/css-parser.ts)：删除 `writeCssFile`（保留 list/read）。
- [preload/index.ts](file:///f:/Web%20Modifier/electron/preload/index.ts)：移除 `writeCssFile` 暴露与类型 import。

### 渲染层 store（主体）
[template-store.ts](file:///f:/Web%20Modifier/src/store/template-store.ts)：
- 新增 state：`cssBaseline: Record<string,string>`（路径→规范化基线文本，懒加载）、`cssOverrides: Record<string,string>`（路径→当前覆盖文本，仅含与基线不同者）。
- 新增纯函数 helper：`overrideCssText(map)` 拼接全部覆盖（注入/重放用）；`collectCssEdits()` 返回 override map（即差异）。
- `loadCssFile(path)`：先从磁盘读基线并在 `cssBaseline[path]` 缺失时记入（基线用规范化文本 `serializeCss(blocks)`，避免格式噪音）；编辑器 blocks 优先取 `cssOverrides[path]`（`parseCss`），否则用磁盘 blocks。
- `updateCssBlock/addCssBlock/removeCssBlock`：同步更新 `cssBlocks` 与 `cssOverrides[file]`（序列化为规范化文本，与基线相同则删 key）；立即注入全部覆盖文本；触发自动草稿（不再调写盘 IPC，删除 `scheduleCssPersist`/`cssPersistTimer` 机制）。
- `flushCss()` 语义改为纯内存同步（确保当前 blocks 已入 override map；无 I/O），保留函数名以减少调用点改动；所有现有调用点行为不变（导出/切页/改名/删除/回主页/关窗）。
- `restoreCssFile()`：删 `cssOverrides[当前文件]`（连带基线保留），blocks 回退磁盘并重注入。
- `saveCssFile()`：改为立即 `persistAutosave()`（样式随草稿保存；未命名项目由自动草稿承接，与 region 一致）。
- 自动草稿：已保存点快照由 edits 扩为 `{edits, cssEdits}` 的 JSON；`persistAutosave/flushAllForQuit` 携带 cssEdits；订阅增加 `cssOverrides` 引用变化 → `scheduleAutosave()`。
- `saveProject`：传 cssEdits，arm 点含两者。
- `openProject` 与 `restoreAutosave`：应用 cssEdits——填入 `cssOverrides`；对每个文件 `readCssFile` 补基线（文件已不存在则丢弃该项）；立即注入全部覆盖。抽公共 helper `applyCssEdits(cssEdits)`。
- `openTemplate`/`resetTemplate`/`restoreTemplate`：重置 `cssBaseline:{}`、`cssOverrides:{}`（restoreTemplate 额外在快照回滚后重扫 CSS 列表）。
- 页面改名 `remapPageKey` 同步对 cssBaseline/cssOverrides/cssCurrentFile 做 `<oldDir>/` 前缀迁移；页面删除清理该前缀；`reloadAfterStructure` 中当前 CSS 文件消失时连带清 override/baseline。
- `exportTemplate`：参数带 `cssEdits: collectCssEdits()`。
- `goHome`：保留 flushCss（内存）+ persistAutosave（已含 CSS）。

### 渲染层组件
- [IframeViewport.tsx](file:///f:/Web%20Modifier/src/components/Editor/IframeViewport.tsx)：wt-ready 重放改为拼接 store 全部 `cssOverrides` 注入。
- [CssEditor.tsx](file:///f:/Web%20Modifier/src/components/CssEditor/CssEditor.tsx)：「立即保存」按钮文案/提示改为"保存到项目草稿"（标题说明编辑随项目保存、可恢复原状）；文件列表项对存在 override 的文件显示小圆点（复用现有样式语言）。

## 实施步骤（依赖顺序）

1. 共享类型 + project-manager（草稿字段透传，默认可选，兼容旧数据）。
2. 主进程：导出覆盖写入 CSS；移除 writeCssFile 三层（service/IPC/preload）。
3. store：cssBaseline/cssOverrides 状态 + helper，改造 load/edit/restore/flush/save。
4. store：自动草稿/保存项目/打开项目/恢复自动草稿 接入 cssEdits。
5. store：结构变更（页面改名/删除/导入/恢复模板）的键迁移与重置。
6. 组件：IframeViewport 全量重放、CssEditor 文案与修改圆点。
7. 验证与真机回归。

## 依赖与注意事项

- CSS 文本规范化：差异比较一律用 `serializeCss(parseCss(text))` 形态，避免空白格式导致"没改也算改"；草稿存规范化全文（CSS 文件体量小）。
- 预览级联：注入 `<style>` 位于 head 末尾，同特异性下覆盖页面 `<link>`，与现状单文件注入机制一致（仅覆盖文件注入，未编辑文件仍走磁盘样式表）。
- 旧草稿/旧模板零迁移：无 cssEdits 即无 CSS 差异；旧版已写盘的 CSS 就是当前基线。
- `custom-css` region（内联样式）不受影响，仍走 region edits。
- 单窗口单会话：override 仅存渲染层内存，切模板/回主页即随自动草稿落盘，无需主进程协议层缓存。

## 验证

- `npx tsc -p tsconfig.web.json --noEmit` + `npx tsc -p tsconfig.node.json --noEmit`
- `npx vitest run`（现有 58 测试不回归；如有纯函数可测性，给 collectCssEdits/键迁移 helper 补少量用例）
- `npm run build`
- 真机回归（重启 Electron）：
  1. 开模板改 CSS → 模板目录内 CSS 文件 mtime/内容不变；
  2. 保存项目 A 改红、项目 B 改蓝 → 各自打开颜色独立；回主页再开"裸模板"为原始样式；
  3. 自动草稿：改 CSS 后回主页/重开出现恢复提示，恢复后样式回来；放弃则为原始样式；
  4. 导出目录中 CSS 为当前会话版本，模板本体不变；
  5. 含子目录 CSS 的页面改名/删除后，样式差异跟随/清理正确；
  6. "恢复原状"按钮只回退当前 CSS 文件。

## 风险

- **风险 1：多个 CSS 文件间级联顺序**——注入合并到一个 `<style>`，文件间顺序按 `cssFiles` 列表排序拼接，尽量贴近原加载顺序；极少数跨文件同特异性规则与磁盘级联可能有差异（现状单文件注入已有同样限制）。
- **风险 2：草稿里记录的 CSS 文件后来被删/改名**——应用时 read 失败即丢弃该项；页面改名做前缀迁移兜底。
- **风险 3：关窗/崩溃时 CSS 未落盘**——编辑即进 override map，自动草稿防抖 800ms 与关窗 `flushAllForQuit` 已覆盖；时序与 region 编辑相同。
