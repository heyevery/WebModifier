// shared/css-isolation.ts
// CSS 项目隔离的纯函数：预览覆盖文本拼接、页面改名时的 CSS 键迁移。
// renderer / 主进程 / 测试共用，不依赖任何 DOM 或 Electron API。
import type { CssEdits } from './types/ipc';

/**
 * 把全部 CSS 覆盖文件按 cssFiles 顺序拼成一段文本，用于注入 iframe 预览。
 * 注入的 <style> 位于 head 末尾，同特异性下覆盖磁盘上的基线样式表。
 */
export function overrideCssText(cssFiles: string[], overrides: CssEdits): string {
  return cssFiles
    .filter((f) => Object.prototype.hasOwnProperty.call(overrides, f))
    .map((f) => overrides[f])
    .join('\n');
}

/** 页面目录改名后，把映射内所有 oldPrefix 下的键迁到 newPrefix */
export function remapCssKeys<T>(
  m: Record<string, T>,
  oldPrefix: string,
  newPrefix: string
): Record<string, T> {
  if (!oldPrefix || oldPrefix === newPrefix) return m;
  const next: Record<string, T> = {};
  for (const [k, v] of Object.entries(m)) {
    next[k.startsWith(oldPrefix) ? newPrefix + k.slice(oldPrefix.length) : k] = v;
  }
  return next;
}
