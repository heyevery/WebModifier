// src/lib/intents.ts
// 轻量意图总线：命令面板/快捷键 → 各组件内的对话框动作。
// 仅用于「需要打开某组件私有弹窗」的命令；纯数据动作直接调 store。

export type IntentId =
  | 'export' // 打开导出对话框
  | 'page-settings' // 打开当前页设置
  | 'site-code' // 打开全站自定义代码对话框
  | 'external-preview' // 导出临时副本并用系统浏览器打开
  | 'save-project' // 保存（未命名时弹命名框）
  | 'restore-template' // 恢复模板确认框
  | 'new-workspace' // 新建工作区对话框
  | 'new-page' // 导入为新页面对话框
  | 'find-replace' // 跨所有页面全局查找替换
  | 'site-head' // 全站 head 默认（favicon/标题/描述/OG）
  | 'import-template'; // 导入 HTML/模板文件夹

const INTENT_EVENT = 'wt-intent';

export function emitIntent(id: IntentId): void {
  window.dispatchEvent(new CustomEvent<IntentId>(INTENT_EVENT, { detail: id }));
}

/** 订阅意图，返回取消订阅函数 */
export function onIntent(handler: (id: IntentId) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<IntentId>).detail);
  window.addEventListener(INTENT_EVENT, listener);
  return () => window.removeEventListener(INTENT_EVENT, listener);
}
