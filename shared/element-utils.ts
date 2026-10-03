// shared/element-utils.ts
// 首元素定位 + 列表值序列化工具
// 「首元素 inner」语义在解析（提取初始值）与导出（替换内容）两侧共用

/** 深度计数法定位片段中首个元素的 inner 范围（兼容嵌套同名标签） */
export function findFirstElementRange(
  html: string
): { innerStart: number; innerEnd: number } | null {
  const open = html.match(/<([a-zA-Z][\w-]*)[^>]*>/);
  if (!open || open.index === undefined) return null;
  const tagName = open[1];
  const innerStart = open.index + open[0].length;
  const tagRe = new RegExp(`<(/?)${tagName}(?=[\\s>])[^>]*>`, 'g');
  tagRe.lastIndex = innerStart;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return { innerStart, innerEnd: m.index };
  }
  return null; // 无匹配闭合（void 元素等）
}

/** 提取首个元素的 inner HTML；无元素时返回原文 trim */
export function extractInnerHtml(html: string): string {
  const r = findFirstElementRange(html);
  return r ? html.slice(r.innerStart, r.innerEnd) : html.trim();
}

/** 替换首个元素的 inner（保留元素本身及属性）；无元素时整体替换 */
export function replaceFirstElementInner(html: string, newInner: string): string {
  const r = findFirstElementRange(html);
  return r ? html.slice(0, r.innerStart) + newInner + html.slice(r.innerEnd) : newInner;
}

/** list 类型区段值（JSON 数组字符串）→ 字符串数组；解析失败返回 [] */
export function parseListItems(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((i) => String(i)) : [];
  } catch {
    return [];
  }
}

/** list 值 → <li> 序列（预览与导出共用，项内容做 HTML 转义） */
export function buildLiHtml(value: string): string {
  return parseListItems(value)
    .map((item) => `  <li>${escapeHtml(item)}</li>`)
    .join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
