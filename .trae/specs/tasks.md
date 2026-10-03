# Web Modifier 功能演进 - 实施任务队列

## 任务总览

本队列对应 `spec.md` 中的 6 个功能需求（FR1-FR6）和 9 条验收标准（AC1-AC9）。
按优先级分为两组：一级工作（FR1-FR4）和二级工作（FR5-FR6）。

---

## 一级工作

### Task 1: 活动栏组件 (ActivityBar)

- **优先级**: high
- **对应 AC**: AC1
- **依赖**: 无
- **状态**: pending

**实现内容**：
- 新建 `src/components/ActivityBar/ActivityBar.tsx`
- 竖向图标栏，含：资源管理器、构建器、历史 三个入口
- 点击切换对应侧边面板，选中态高亮
- 可折叠（点击活动栏图标切换面板显隐）
- 图标使用内联 SVG，hover/active 动画

**测试要求 (TR)**：
- (rule) 活动栏渲染 3 个图标按钮，点击可切换侧边面板显隐
- (rule) 选中图标有视觉区分（高亮背景）

**完成证据**: 活动栏组件渲染正常，点击切换面板工作

---

### Task 2: 资源管理器文件树 (FileTree)

- **优先级**: high
- **对应 AC**: AC1, AC2
- **依赖**: Task 1
- **状态**: pending

**实现内容**：
- 新建 `src/components/FileTree/FileTree.tsx`
- 树形展示当前模板内所有文件（递归目录结构）
- 文件图标按类型区分（html/css/js/image）
- 文件夹可展开/折叠
- 新增 IPC：`wt:list-files` 返回模板目录的文件树结构
- `shared/types/ipc.ts` 增加 `ListFilesArgs/Result` 类型

**测试要求 (TR)**：
- (rule) 打开模板后，文件树展示该模板目录下所有文件和子目录
- (rule) 文件夹可展开/折叠
- (rule) 不同文件类型显示不同图标

**完成证据**: 文件树正确展示模板目录结构

---

### Task 3: 标签页栏 (TabBar)

- **优先级**: high
- **对应 AC**: AC1, AC2
- **依赖**: Task 1
- **状态**: pending

**实现内容**：
- 新建 `src/components/TabBar/TabBar.tsx`
- 顶部标签栏，显示已打开的页面
- 每个标签：文件名 + 关闭按钮，当前激活标签高亮
- 点击标签切换页面
- 关闭标签：最后一个关闭时回到空白态
- 状态管理：store 增加 `openTabs: string[]`, `activeTab: string`

**测试要求 (TR)**：
- (rule) 打开页面后标签栏出现对应标签
- (rule) 点击标签切换编辑器显示
- (rule) 关闭标签从标签栏移除

**完成证据**: 标签页打开/切换/关闭正常

---

### Task 4: App.tsx 布局重构整合

- **优先级**: high
- **对应 AC**: AC1
- **依赖**: Task 1, 2, 3
- **状态**: pending

**实现内容**：
- 重构 `src/App.tsx` 为 VS Code 风格布局：
  - 最左：ActivityBar
  - 左：资源管理器面板（可折叠）
  - 中：TabBar + IframeViewport
  - 右：PropertyPanel
- 保留原有 TopBar（标题/导出按钮）
- store 增加面板显隐状态 `explorerVisible`, `builderVisible`
- 移除旧 TemplateList 的模板列表功能（由文件树替代），保留导入入口

**测试要求 (TR)**：
- (rule) 布局呈现：活动栏 + 文件树 + 标签页 + 编辑器 + 属性面板
- (rule) 活动栏切换面板显隐正常
- (rule) 原有模板导入功能仍可用

**完成证据**: 整体布局与 VS Code 风格一致，所有面板可正常交互

---

### Task 5: 文件树点击打开页面

- **优先级**: high
- **对应 AC**: AC2
- **依赖**: Task 2, 3
- **状态**: pending

**实现内容**：
- 文件树中点击 HTML 文件 → 调用 store 打开该页面
- 若页面已在标签中 → 切换到该标签
- 若未打开 → 新增标签并解析该页面 regions
- store 增加 `openPage(page: string)` action
- 非 HTML 文件点击不做处理（仅展示）

**测试要求 (TR)**：
- (rule) 点击文件树 HTML 文件 → 编辑器加载该页面，可编辑区段被识别
- (rule) 重复点击已打开页面 → 切换到对应标签，不重复添加

**完成证据**: 点击文件树 HTML 文件正确加载并解析

---

### Task 6: iframe 内链接拦截跳转

- **优先级**: high
- **对应 AC**: AC2
- **依赖**: Task 5
- **状态**: pending

**实现内容**：
- 修改 `shared/inject-script.ts`：拦截 iframe 内 `<a>` 点击事件
- 若 href 指向同模板内其他 HTML 页面（相对路径）→ postMessage `wt-navigate` 通知父端
- 父端（IframeViewport）收到后调用 store 切换页面
- 外部链接（http/https/mailto）保持默认行为（系统浏览器打开）
- `shared/types/region.ts` 增加 `wt-navigate` 消息类型

**测试要求 (TR)**：
- (rule) 点击 iframe 内指向同模板页面的链接 → 编辑器自动切换到目标页面
- (rule) 点击外部链接 → 用系统浏览器打开，不切换编辑器

**完成证据**: 页面内链接可触发编辑器页面切换

---

### Task 7: 标签页状态管理与编辑状态跟踪

- **优先级**: medium
- **对应 AC**: AC2
- **依赖**: Task 3, 5
- **状态**: pending

**实现内容**：
- store 中每个标签记录页面路径和是否有未保存修改（dirty flag）
- 关闭标签时若 dirty → 确认提示
- 各页面 regions 值独立存储（按页面分组）
- 切换标签时恢复对应页面的 regions 和选中状态

**测试要求 (TR)**：
- (rule) 切换标签后再切回，该页面的编辑值不丢失
- (rule) 关闭有修改的标签时弹出确认提示

**完成证据**: 多标签编辑状态互不干扰

---

### Task 8: 编辑历史（撤销/重做）

- **优先级**: high
- **对应 AC**: AC3
- **依赖**: Task 4
- **状态**: pending

**实现内容**：
- store 增加历史栈：`history: HistoryEntry[]`, `historyIndex: number`
- `HistoryEntry` 包含：regionId, oldValue, newValue, timestamp, label
- `updateRegionValue` 时自动压入历史记录（old+new 完整快照）
- 新增 `undo()` / `redo()` actions
- 撤销时用 oldValue 回滚，重做时用 newValue 恢复
- 空字符串值用 `!== undefined` 判断（经验教训）
- 键盘快捷键：Ctrl+Z 撤销，Ctrl+Y / Ctrl+Shift+Z 重做
- 新分支操作时裁剪 redo 栈

**测试要求 (TR)**：
- (rule) 修改值后 Ctrl+Z → 值恢复到修改前
- (rule) 撤销后 Ctrl+Y → 值恢复到修改后
- (rule) 连续 3 次修改后逐步撤销，每次回退一步
- (rule) 将值改为空字符串后撤销，能恢复原值

**完成证据**: 撤销/重做在各种场景下行为正确

---

### Task 9: 导航历史（前进/后退）

- **优先级**: high
- **对应 AC**: AC4
- **依赖**: Task 5, 6
- **状态**: pending

**实现内容**：
- store 增加导航栈：`navHistory: string[]`, `navIndex: number`
- 页面切换时记录（文件树点击、链接跳转、标签切换均记录）
- 新增 `navigateBack()` / `navigateForward()` actions
- TopBar 增加前进/后退按钮（浏览器风格）
- 后退/后退时按钮 disabled 状态正确

**测试要求 (TR)**：
- (rule) 页面 A→B→C 后点后退 → 回到 B，再后退 → 回到 A
- (rule) 后退后点前进 → 回到 B，再前进 → 回到 C
- (rule) 后退到栈底时后退按钮 disabled

**完成证据**: 导航前进后退工作正常

---

### Task 10: 历史面板 UI

- **优先级**: medium
- **对应 AC**: AC3
- **依赖**: Task 8
- **状态**: pending

**实现内容**：
- 活动栏「历史」图标切换到历史面板
- `src/components/HistoryPanel/HistoryPanel.tsx`
- 展示编辑历史列表（时间倒序），每条显示：区段名、操作类型、时间
- 当前历史位置高亮
- 点击历史项可回滚到该状态
- 导航历史和编辑历史分区展示

**测试要求 (TR)**：
- (rule) 历史面板展示所有编辑操作记录
- (rule) 点击历史项 → 值回滚到对应状态
- (rule) 当前历史位置有高亮标识

**完成证据**: 历史面板可查看并回滚编辑历史

---

### Task 11: 主进程 ZIP 打包

- **优先级**: high
- **对应 AC**: AC5
- **依赖**: 无
- **状态**: pending

**实现内容**：
- 安装轻量 ZIP 库（如 `archiver`）或使用 Node 内置方案
- `electron/main/services/zipper.ts`：将指定目录打包为 ZIP
- 修改 `IPC.EXPORT_TEMPLATE` 处理器：导出文件夹后，若 `zip: true` 则打包
- 返回结果增加 `zipPath` 字段
- `shared/types/ipc.ts` 更新 `ExportTemplateArgs`（增加 `zip?: boolean`）和 `ExportTemplateResult`（增加 `zipPath`）

**测试要求 (TR)**：
- (rule) 传入 zip:true → 导出后同目录生成同名 .zip
- (rule) ZIP 解压后文件结构与导出文件夹一致
- (rule) 传入 zip:false → 不生成 ZIP

**完成证据**: 导出时可选生成 ZIP 压缩包

---

### Task 12: 导出对话框增加 ZIP 选项

- **优先级**: high
- **对应 AC**: AC5
- **依赖**: Task 11
- **状态**: pending

**实现内容**：
- `ExportDialog.tsx` 增加「打包为 ZIP」复选框（默认勾选）
- 导出时将 zip 选项传入 store
- 导出成功后提示 ZIP 文件路径（若有）
- TopBar 成功提示展示 ZIP 路径

**测试要求 (TR)**：
- (rule) 导出对话框显示「打包为 ZIP」复选框
- (rule) 勾选导出后生成 ZIP，提示 ZIP 路径
- (rule) 不勾选则不生成 ZIP

**完成证据**: 导出对话框可控制是否打包 ZIP

---

## 二级工作

### Task 13: 新增可编辑类型定义

- **优先级**: medium
- **对应 AC**: AC7
- **依赖**: 无
- **状态**: pending

**实现内容**：
- `shared/types/region.ts` 的 `EDITABLE_TYPES` 增加：`video`, `audio`, `button`, `divider`, `spacer`, `input`, `textarea`, `select`, `checkbox`
- 各类型的值语义定义：
  - video: JSON `{src, poster, controls}`
  - audio: JSON `{src, controls}`
  - button: 文本（同 text，但元素为 button/a）
  - divider: 样式描述 `{style, color}`
  - spacer: 高度值（px）
  - input: JSON `{type, placeholder, value}`
  - textarea: JSON `{placeholder, value}`
  - select: JSON `{options: [{label,value}], value}`
  - checkbox: JSON `{checked, label}`

**测试要求 (TR)**：
- (rule) 类型定义文件编译通过，新类型被 `EditableType` 联合类型包含

**完成证据**: 类型系统支持新组件类型

---

### Task 14: 解析器与导出器支持新类型

- **优先级**: medium
- **对应 AC**: AC7
- **依赖**: Task 13
- **状态**: pending

**实现内容**：
- `marker-parser.ts` 的 `extractValueByType` 增加新类型的值提取
- `exporter.ts` 的 `exportTemplate` switch 增加新类型分支
- 新类型导出时正确写回 HTML 属性/内容
- `shared/element-utils.ts` 可能需要辅助函数

**测试要求 (TR)**：
- (rule) 含新类型标记的 HTML 能被正确解析出值
- (rule) 修改新类型值后导出，HTML 中对应属性被正确更新
- (rule) 导出后所有 `@wt:*` 标记被剥离

**完成证据**: 新类型解析和导出闭环打通

---

### Task 15: 属性面板新类型编辑控件

- **优先级**: medium
- **对应 AC**: AC7
- **依赖**: Task 13, 14
- **状态**: pending

**实现内容**：
- `PropertyPanel.tsx` 为每种新类型渲染对应表单控件：
  - video: src 输入 + poster 选择 + controls 开关
  - audio: src 输入 + controls 开关
  - button: 文本输入 + 链接输入
  - divider: 样式选择 + 颜色
  - spacer: 高度滑块
  - input: type 选择 + placeholder + value
  - textarea: placeholder + value
  - select: 选项列表编辑 + 默认值
  - checkbox: 选中开关 + 标签文本
- 值序列化为对应 JSON 格式存入 region.value

**测试要求 (TR)**：
- (rule) 每种新类型在属性面板有专属编辑控件
- (rule) 修改控件值后 region.value 正确更新
- (rule) iframe 实时预览更新

**完成证据**: 所有新类型可通过属性面板编辑

---

### Task 16: 空白模板创建

- **优先级**: medium
- **对应 AC**: AC6
- **依赖**: Task 4
- **状态**: pending

**实现内容**：
- 活动栏或文件树增加「新建空白模板」按钮
- 新增 IPC `wt:create-blank-template`：创建含最小 HTML 骨架的模板目录
- 模板含 `index.html`（带 `<head><body>` 空结构）和 `config.wt.json`
- 创建后自动打开该模板

**测试要求 (TR)**：
- (rule) 点击「新建空白模板」创建新模板并打开
- (rule) 空白模板包含有效的 HTML 骨架，可被解析器解析

**完成证据**: 可创建并打开空白模板

---

### Task 17: 组件面板与拖拽

- **优先级**: medium
- **对应 AC**: AC6
- **依赖**: Task 16
- **状态**: pending

**实现内容**：
- `src/components/ComponentPalette/ComponentPalette.tsx`
- 分类展示可拖拽组件：基础/媒体/布局/表单
- 使用 HTML5 Drag and Drop API
- 每个组件项可拖拽，携带组件类型数据
- 画布（iframe overlay）作为 drop target
- 拖拽时画布显示放置指示线

**测试要求 (TR)**：
- (rule) 组件面板展示分类组件列表
- (rule) 组件项可拖拽
- (rule) 画布接受 drop

**完成证据**: 组件可从面板拖拽到画布

---

### Task 18: 画布放置与标记注入

- **优先级**: medium
- **对应 AC**: AC6
- **依赖**: Task 17
- **状态**: pending

**实现内容**：
- drop 时根据组件类型生成带 `@wt:edit` 标记的 HTML 片段
- 将片段插入到 body 末尾（或指定位置）
- 重新解析页面，新组件出现在可编辑区段列表
- iframe 实时显示新组件
- 插入后属性面板可编辑该新组件

**测试要求 (TR)**：
- (rule) 拖拽组件到画布 → 画布出现对应 HTML 元素
- (rule) 新元素带有 `@wt:edit` 标记，可被属性面板编辑
- (rule) 导出时新组件标记被剥离，值被正确写入

**完成证据**: 拖拽放置的组件可编辑可导出

---

### Task 19: 构建器保存为模板

- **优先级**: low
- **对应 AC**: AC6
- **依赖**: Task 18
- **状态**: pending

**实现内容**：
- 构建器中搭建的页面可保存
- 保存时将当前 HTML（含 `@wt:edit` 标记）写入模板文件
- 保存后模板出现在模板列表，可切换到常规编辑模式
- 区分「构建模式」和「编辑模式」，可切换

**测试要求 (TR)**：
- (rule) 构建器中保存后，模板出现在模板列表
- (rule) 保存的模板可正常打开编辑和导出

**完成证据**: 构建器页面可保存为可编辑模板

---

## 验收覆盖矩阵

| AC | 覆盖任务 |
|----|----------|
| AC1 | Task 1, 2, 3, 4 |
| AC2 | Task 2, 3, 5, 6, 7 |
| AC3 | Task 8, 10 |
| AC4 | Task 9 |
| AC5 | Task 11, 12 |
| AC6 | Task 16, 17, 18, 19 |
| AC7 | Task 13, 14, 15 |
| AC8 | Task 1, 4, 17, 18 |
| AC9 | Task 1, 4 |
