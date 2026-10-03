---
name: backlog-feature-workflow
description: Implement Web Modifier backlog items via the fixed rhythm — shared logic+tests, IPC/preload/store, UI, verification, memory update. Use when user says 继续 or asks for the next backlog item in this workspace.
---

# Web Modifier Backlog 功能迭代流程

在本工作区（f:\Web Modifier，Electron 31 + electron-vite + React 18 + zustand + TS + Tailwind wt-* 语义类）按 backlog 实现功能时，严格遵循以下节奏。Backlog 位于 `c:\Users\DELL\.trae-cn\memory\projects\-f-Web-Modifier--p2-49c78a42b523e1d963fa\project_memory.md` 的 `## Feature Backlog` → `### 真实待办`，开始前先读取该文件确认下一条未完成项与已完成项（旧盘点中很多功能早已落地，勿重复立项）。

## 固定分层节奏

1. **shared 纯逻辑先行**：可复用逻辑写成 `shared/*.ts` 纯函数（无 DOM、无 fs、无 Electron 依赖），配套 `test/<name>.test.ts`（vitest）。
2. **主进程能力**：需要文件系统/系统能力时，在 `electron/main/services/` 或 `electron/main/ipc/template.ts` 加实现；通道名与类型契约先写进 `shared/types/ipc.ts`（IPC 常量 + Args/Result 接口 + WebModifierApi 方法签名三处都要改），再在 `electron/preload/index.ts` 暴露。
3. **store**：渲染层动作加到 `src/store/template-store.ts`（很大，先 Grep 定位接口声明与实现两处）；错误出口统一 `set({ error })`，不要直接 alert。
4. **UI**：组件放 `src/components/<Feature>/`；样式只用 wt-* 语义类（wt-bg/wt-surface/wt-border/wt-text/wt-muted/wt-primary/wt-success/wt-warning/wt-danger）；反馈用全局 toast（`@/components/Toast/toast` 的 toast.success/error/info），不要新增 window.alert；动画用 framer-motion。
5. **更新 backlog 记忆**：完成后把该条改为 `【已完成 日期】…` 并简述落点，不新增 md 文档、不 git commit（除非用户明确要求）。

## 硬约束（违反会直接构建失败或功能损坏）

- 测试只能 import `@shared/*` 与 electron/services；**不能 import src/***（composite project 报 TS6307）。
- TS 类型习惯：React 用 `import { type ReactNode } from 'react'`；zustand 用 `import { type StoreApi } from 'zustand'`。
- 别名：`@`→src，`@shared`→shared。
- 会话重置（openTemplate/restoreTemplate/resetTemplate/goHome）若新增了会话状态字段，必须同步清空。
- displayHtmlMap（template-protocol.ts）命中的 HTML 带 data-wt-rid；任何缓存淘汰逻辑必须保护当前编辑模板的键，否则 iframe 选中/框选失效。
- 模板盘是干净基线：会话编辑、CSS 覆盖、注入代码只写会话/项目草稿/导出副本，不写模板文件（页面 head 设置除外，它本就持久化到磁盘）。
- PowerShell 5：命令链式用 `;` 不用 `&&`，无 bash 语法。

## 验证三连（每步功能完成后必须全绿）

```
npx tsc -p tsconfig.web.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npx vitest run
npm run build
```

- 主进程/preload/shared 改动：渲染层 HMR 不够，需停掉后台 dev job（StopCommand）后 `npm run dev`（run_in_background），等约 12 秒看到 "start electron app"；Autofill.enable / GPU cache 报错是已知噪音。
- 仅 src/ 改动：确认 HMR 日志无报错即可，不必重启。
- 报告测试数时用本次实际数字（tests 总数会随新增用例变化，别照抄旧数字）。

## 工作方式

- 用户偏好分步小改、每步验证；动手前先用 TodoWrite 列出 4-6 步（调研→分层实现→验证）。
- 调研优先 Read/Grep 实际代码，不凭记忆假设 API；IPC 改动遵循"契约三处 + preload 一处"的完整性。
- 完成后简明汇报：新增文件（可点击绝对路径链接）、接线点、验证结果，并询问是否继续下一条 backlog。
