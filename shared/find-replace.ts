// shared/find-replace.ts
// 跨页面全局查找替换（改公司名/电话等场景）。仅作用于「可编辑区域」内的文字字段，
// 不碰模板原始 HTML / 文件路径（img src、video src 等不参与，避免改坏链接）。
// 纯函数、无 DOM/fs 依赖，可直接单测。

import type { Region, EditableType } from './types/region';

export interface FindReplaceOptions {
  caseSensitive: boolean;
}

/** 单个区域的命中信息 */
export interface RegionMatch {
  page: string;
  regionId: string;
  label: string;
  type: EditableType;
  /** 命中总次数（区域内所有参与字段之和） */
  count: number;
  /** 首次命中的上下文片段（已去标签，仅用于展示） */
  snippet: string;
}

export interface ChangedRegion {
  regionId: string;
  count: number;
  newValue: string;
}

export interface ReplaceResult {
  regions: Region[];
  changed: ChangedRegion[];
  totalCount: number;
}

/** 区域内参与查找替换的文本字段（key 仅内部用于定位重建） */
interface TextField {
  key: string;
  text: string;
}

function safeParseJson(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 直接把整个 value 当文本的类型 */
const PLAIN_TEXT_TYPES: ReadonlySet<EditableType> = new Set<EditableType>([
  'text',
  'button',
  'richtext',
  'html'
]);

/**
 * 取出某 region 值中参与查找替换的文本字段。
 * - text/button：纯文本值
 * - link：链接文字 + href（电话号码替换需同步 tel:）
 * - image：仅 alt（src 是文件路径，不参与）
 * - list：JSON 字符串数组，每项一个字段
 * - input/textarea：placeholder 与 value
 * - select：各选项的 label/value
 * - checkbox：label
 * - color/custom-css/spacer/divider/video/audio：不参与（样式/路径类）
 */
function extractFields(region: Region): TextField[] {
  const { type, value } = region;
  if (PLAIN_TEXT_TYPES.has(type)) {
    return [{ key: '', text: value }];
  }
  const parsed = safeParseJson(value);
  if (parsed === null || typeof parsed !== 'object') return [];

  if (type === 'link') {
    const v = parsed as { href?: unknown; text?: unknown };
    const fields: TextField[] = [];
    if (typeof v.text === 'string') fields.push({ key: 'text', text: v.text });
    if (typeof v.href === 'string') fields.push({ key: 'href', text: v.href });
    return fields;
  }
  if (type === 'image') {
    const v = parsed as { alt?: unknown };
    return typeof v.alt === 'string' ? [{ key: 'alt', text: v.alt }] : [];
  }
  if (type === 'list') {
    return Array.isArray(parsed)
      ? (parsed as unknown[])
          .map((item, i): TextField | null =>
            typeof item === 'string' ? { key: String(i), text: item } : null
          )
          .filter((f): f is TextField => f !== null)
      : [];
  }
  if (type === 'input' || type === 'textarea') {
    const v = parsed as { placeholder?: unknown; value?: unknown };
    const fields: TextField[] = [];
    if (typeof v.placeholder === 'string') fields.push({ key: 'placeholder', text: v.placeholder });
    if (typeof v.value === 'string') fields.push({ key: 'value', text: v.value });
    return fields;
  }
  if (type === 'select') {
    const v = parsed as { options?: unknown };
    if (!Array.isArray(v.options)) return [];
    const fields: TextField[] = [];
    v.options.forEach((opt, i) => {
      if (!opt || typeof opt !== 'object') return;
      const o = opt as { label?: unknown; value?: unknown };
      if (typeof o.label === 'string') fields.push({ key: `o${i}.label`, text: o.label });
      if (typeof o.value === 'string') fields.push({ key: `o${i}.value`, text: o.value });
    });
    return fields;
  }
  if (type === 'checkbox') {
    const v = parsed as { label?: unknown };
    return typeof v.label === 'string' ? [{ key: 'label', text: v.label }] : [];
  }
  return [];
}

/** 按 extractFields 同样的路径把改后的字段写回 value（返回新值串） */
function rebuildValue(region: Region, updates: Map<string, string>): string {
  const { type, value } = region;
  if (PLAIN_TEXT_TYPES.has(type)) return updates.get('') ?? value;
  const parsed = safeParseJson(value);
  if (parsed === null || typeof parsed !== 'object') return value;

  if (type === 'link') {
    const v = parsed as Record<string, unknown>;
    if (updates.has('text')) v.text = updates.get('text');
    if (updates.has('href')) v.href = updates.get('href');
    return JSON.stringify(v);
  }
  if (type === 'image') {
    if (!updates.has('alt')) return value;
    return JSON.stringify({ ...(parsed as object), alt: updates.get('alt') });
  }
  if (type === 'list') {
    if (!Array.isArray(parsed)) return value;
    const next = [...(parsed as unknown[])];
    for (const [key, text] of updates) next[Number(key)] = text;
    return JSON.stringify(next);
  }
  if (type === 'input' || type === 'textarea' || type === 'checkbox') {
    const v = { ...(parsed as Record<string, unknown>) };
    for (const [key, text] of updates) v[key] = text;
    return JSON.stringify(v);
  }
  if (type === 'select') {
    const v = parsed as { options?: unknown };
    if (!Array.isArray(v.options)) return value;
    const options = [...(v.options as unknown[])];
    for (const [key, text] of updates) {
      const m = /^o(\d+)\.(label|value)$/.exec(key);
      if (!m) continue;
      const i = Number(m[1]);
      const field = m[2];
      if (options[i] && typeof options[i] === 'object') {
        options[i] = { ...(options[i] as Record<string, unknown>), [field]: text };
      }
    }
    return JSON.stringify({ ...v, options });
  }
  return value;
}

/** 转义正则元字符（用于按字面量匹配） */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 统计 needle 在 haystack 中的出现次数（重叠匹配也算，如 'aa' in 'aaa' = 2 不采用——
 *  这里按自然语言替换语义，使用非重叠计数：split 长度-1） */
export function countOccurrences(haystack: string, needle: string, opts: FindReplaceOptions): number {
  if (!needle) return 0;
  if (opts.caseSensitive) return haystack.split(needle).length - 1;
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}

function indexOfNeedle(haystack: string, needle: string, opts: FindReplaceOptions, from = 0): number {
  if (!needle) return -1;
  return opts.caseSensitive
    ? haystack.indexOf(needle, from)
    : haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

/** 字面量替换全部命中（大小写不敏感时保留被替换处的大小写策略——直接整段换为 replacement） */
export function replaceLiteral(
  haystack: string,
  needle: string,
  replacement: string,
  opts: FindReplaceOptions
): string {
  if (!needle) return haystack;
  if (opts.caseSensitive) return haystack.split(needle).join(replacement);
  const re = new RegExp(escapeRegExp(needle), 'gi');
  return haystack.replace(re, () => replacement);
}

/** 生成首次命中上下文片段：去标签、压空白、两侧各留约 18 字符 */
function makeSnippet(haystack: string, needle: string, opts: FindReplaceOptions): string | null {
  const idx = indexOfNeedle(haystack, needle, opts);
  if (idx < 0) return null;
  const plain = haystack.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  // 标签去除后索引可能偏移，在纯文本上重新定位
  const pIdx = indexOfNeedle(plain, needle, opts);
  const center = pIdx >= 0 ? pIdx : 0;
  const start = Math.max(0, center - 18);
  const end = Math.min(plain.length, center + needle.length + 18);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

/**
 * 在一批 region（通常是某页面或全部页面）中查找。
 * 只返回有命中的 region，按入参顺序。
 */
export function findInRegions(
  regions: readonly Region[],
  query: string,
  opts: FindReplaceOptions
): RegionMatch[] {
  if (!query) return [];
  const out: RegionMatch[] = [];
  for (const region of regions) {
    let count = 0;
    let snippet = '';
    for (const field of extractFields(region)) {
      const c = countOccurrences(field.text, query, opts);
      if (c <= 0) continue;
      count += c;
      if (!snippet) {
        snippet = makeSnippet(field.text, query, opts) ?? field.text.slice(0, 60);
      }
    }
    if (count > 0) {
      out.push({
        page: region.page,
        regionId: region.id,
        label: region.label || region.id,
        type: region.type,
        count,
        snippet
      });
    }
  }
  return out;
}

/**
 * 在一批 region 中执行全部替换。返回新数组与变更明细；无命中时返回原数组。
 */
export function replaceInRegions(
  regions: readonly Region[],
  query: string,
  replacement: string,
  opts: FindReplaceOptions
): ReplaceResult {
  if (!query) return { regions: regions.slice(), changed: [], totalCount: 0 };
  const next: Region[] = [];
  const changed: ChangedRegion[] = [];
  let totalCount = 0;

  for (const region of regions) {
    const updates = new Map<string, string>();
    let regionCount = 0;
    for (const field of extractFields(region)) {
      const c = countOccurrences(field.text, query, opts);
      if (c <= 0) continue;
      regionCount += c;
      updates.set(field.key, replaceLiteral(field.text, query, replacement, opts));
    }
    if (regionCount === 0) {
      next.push(region);
      continue;
    }
    const newValue = rebuildValue(region, updates);
    if (newValue === region.value) {
      next.push(region);
      continue;
    }
    totalCount += regionCount;
    changed.push({ regionId: region.id, count: regionCount, newValue });
    next.push({ ...region, value: newValue });
  }

  return { regions: next, changed, totalCount };
}
