// electron/main/services/marker-parser.ts
// 解析 HTML 中的 @wt:edit 标记 → Region[]
// 同时生成注入 data-wt-rid 的显示用 HTML

import type { EditableType, Region, WTConfig } from '@shared/types/region';
import { extractInnerHtml } from '@shared/element-utils';

// 块级注释标记：<!-- @wt:edit name="..." type="..." label="..." prop="..." --> ... <!-- /@wt:edit -->
// 全站公共区同构：@wt:shared ... <!-- /@wt:shared -->（同名标记跨页共享一个值）
const BLOCK_PATTERN = (marker: 'edit' | 'shared'): RegExp =>
  new RegExp(
    `<!--\\s*@wt:${marker}\\s+name="([^"]+)"(?:\\s+type="([^"]+)")?(?:\\s+label="([^"]+)")?(?:\\s+prop="([^"]+)")?\\s*-->([\\s\\S]*?)<!--\\s*\\/@wt:${marker}\\s*-->`,
    'g'
  );

// 单元素属性标记：<tag ... data-wt-edit="..." data-wt-type="..." data-wt-label="..." data-wt-prop="...">...</tag>
// 公共区版本使用 data-wt-shared="..."
const ATTR_PATTERN = (marker: 'edit' | 'shared'): RegExp =>
  new RegExp(
    `<([a-zA-Z][\\w-]*)((?:[^>"']|"[^"]*")*?)\\s+data-wt-${marker}="([^"]+)"(?:\\s+data-wt-type="([^"]+)")?(?:\\s+data-wt-label="([^"]+)")?(?:\\s+data-wt-prop="([^"]+)")?([^>]*)>([\\s\\S]*?)<\\/\\1>`,
    'g'
  );

// 单元素属性标记（void 元素版）：<input>/<img>/<hr>/<br> 等无闭合标签，需单独匹配
const VOID_ATTR_PATTERN = (marker: 'edit' | 'shared'): RegExp =>
  new RegExp(
    `<([a-zA-Z][\\w-]*)((?:[^>"']|"[^"]*")*?)\\s+data-wt-${marker}="([^"]+)"(?:\\s+data-wt-type="([^"]+)")?(?:\\s+data-wt-label="([^"]+)")?(?:\\s+data-wt-prop="([^"]+)")?([^>]*?)\\/?>`,
    'g'
  );

export interface ParseOutput {
  regions: Region[];
  displayHtml: string;
}

interface MatchInfo {
  start: number;
  end: number; // exclusive
  newContent: string;
  region: Region;
}

/**
 * 解析单页模板 HTML
 * @param html 原始 HTML 字符串
 * @param config 来自 config.wt.json 的元数据（用于默认值回填）
 * @param page 所属页面（相对模板根的 POSIX 路径）
 */
export function parseTemplate(html: string, config: WTConfig | null, page: string): ParseOutput {
  const matches: MatchInfo[] = [];
  const regions: Region[] = [];

  // 依次处理普通编辑区与全站公共区（同构，仅标记名与 shared 标志不同）
  const variants: { marker: 'edit' | 'shared'; shared: boolean }[] = [
    { marker: 'edit', shared: false },
    { marker: 'shared', shared: true }
  ];

  for (const variant of variants) {
    // 收集块级注释标记
    for (const m of html.matchAll(BLOCK_PATTERN(variant.marker))) {
      const [fullMatch, id, typeRaw, label, prop, innerHtml] = m;
      const type = (typeRaw as EditableType) || 'text';
      const rid = `${id}-0`;

      // config 中的默认值优先，否则按类型从 innerHtml 提取
      const metaDefault = config?.editable?.[id]?.default;
      const extractedValue = extractValueByType(innerHtml, type, prop);
      const value = resolveDefault(type, metaDefault, extractedValue);

      const newInner = injectRidOnFirstElement(innerHtml, rid);

      const region: Region = {
        id,
        kind: 'block',
        type,
        label,
        prop: prop || (type === 'color' ? 'color' : undefined),
        page,
        value,
        anchorRids: [rid],
        innerHtml,
        byteRange: { start: m.index ?? 0, end: (m.index ?? 0) + fullMatch.length - 1 },
        ...(variant.shared ? { shared: true } : {})
      };
      matches.push({
        start: m.index ?? 0,
        end: (m.index ?? 0) + fullMatch.length,
        newContent: newInner,
        region
      });
      regions.push(region);
    }

    // 收集单元素属性标记（常规元素 + void 元素共用处理逻辑）
    const processAttrMatch = (m: RegExpMatchArray, isVoid: boolean): void => {
      const [fullMatch, tag, beforeAttrs, id, typeRaw, label, prop, afterAttrs, innerContent] = m;
      const type = (typeRaw as EditableType) || 'text';
      const rid = `${id}-0`;

      const metaDefault = config?.editable?.[id]?.default;
      const extractedValue = extractValueByType(fullMatch, type, prop);
      const value = resolveDefault(type, metaDefault, extractedValue);

      // 移除 data-wt-* 属性，注入 data-wt-rid（void 元素无闭合部分）
      const newEl = isVoid
        ? `<${tag}${beforeAttrs} data-wt-rid="${rid}"${afterAttrs}>`
        : `<${tag}${beforeAttrs} data-wt-rid="${rid}"${afterAttrs}>${innerContent}</${tag}>`;

      const region: Region = {
        id,
        kind: 'attr',
        type,
        label,
        prop: prop || (type === 'color' ? 'color' : undefined),
        page,
        value,
        anchorRids: [rid],
        innerHtml: fullMatch,
        byteRange: { start: m.index ?? 0, end: (m.index ?? 0) + fullMatch.length - 1 },
        ...(variant.shared ? { shared: true } : {})
      };
      matches.push({
        start: m.index ?? 0,
        end: (m.index ?? 0) + fullMatch.length,
        newContent: newEl,
        region
      });
      regions.push(region);
    };

    for (const m of html.matchAll(ATTR_PATTERN(variant.marker))) {
      processAttrMatch(m, false);
    }
    // void 白名单：防止 VOID 正则吞掉常规元素的开始标签造成重叠匹配
    const VOID_TAGS = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
    ]);
    for (const m of html.matchAll(VOID_ATTR_PATTERN(variant.marker))) {
      if (VOID_TAGS.has(m[1].toLowerCase())) {
        processAttrMatch(m, true);
      }
    }
  }

  // 按 start 升序， stitching displayHtml
  matches.sort((a, b) => a.start - b.start);
  // regions 跨 edit/shared 两个变体收集，同样按文档顺序排好（大纲/属性面板依赖该顺序）
  regions.sort((a, b) => (a.byteRange?.start ?? 0) - (b.byteRange?.start ?? 0));
  let displayHtml = '';
  let lastEnd = 0;
  for (const info of matches) {
    displayHtml += html.substring(lastEnd, info.start);
    displayHtml += info.newContent;
    lastEnd = info.end;
  }
  displayHtml += html.substring(lastEnd);

  return { regions, displayHtml };
}

/**
 * 从 innerHtml 中提取文本值
 * Phase 1 简化实现：取首个元素对的文本内容；纯文本则直接 trim
 */
function extractTextValue(innerHtml: string): string {
  const m = innerHtml.match(/<[^>]+>\s*([^<]*?)\s*<\/[^>]+>/);
  if (m) return m[1].trim();
  return innerHtml.trim();
}

// 提取 HTML 中首个 attr="value" 的值（无引号/单引号兼容）
function extractAttrValue(html: string, attrName: string): string | null {
  const m = html.match(new RegExp(`\\s${attrName}\\s*=\\s*"([^"]*)"`));
  if (m) return m[1];
  const m2 = html.match(new RegExp(`\\s${attrName}\\s*=\\s*'([^']*)'`));
  if (m2) return m2[1];
  return null;
}

// 提取 style 内指定 CSS 属性的值，如 style="color: #333" + prop=color → #333
function extractStyleProp(html: string, prop: string): string | null {
  const style = extractAttrValue(html, 'style');
  if (!style) return null;
  const m = style.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'));
  return m ? m[1].trim() : null;
}

// 提取 style 内全部 CSS 属性为 { prop: value } 对象（custom-css 类型初始值）
function extractAllStyleProps(html: string): Record<string, string> {
  const style = extractAttrValue(html, 'style');
  if (!style) return {};
  const out: Record<string, string> = {};
  for (const m of style.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

/**
 * 计算 region 初始值：config 默认值优先。
 * link/image 为 JSON 结构，兼容 config 中遗留的纯字符串默认值（视为 href/src）。
 */
function resolveDefault(type: EditableType, metaDefault: string | undefined, extracted: string): string {
  if (metaDefault === undefined) return extracted;
  if (type === 'link') {
    const parsed = tryJson<{ href?: string; text?: string } | null>(metaDefault, null);
    if (parsed && typeof parsed === 'object') return JSON.stringify({ href: parsed.href ?? '', text: parsed.text ?? '' });
    // 旧格式：纯字符串 href，文字沿用从 HTML 提取的值
    const cur = tryJson<{ href?: string; text?: string }>(extracted, { href: '', text: '' });
    return JSON.stringify({ href: metaDefault, text: cur.text ?? '' });
  }
  if (type === 'image') {
    const parsed = tryJson<{ src?: string; alt?: string } | null>(metaDefault, null);
    if (parsed && typeof parsed === 'object') return JSON.stringify({ src: parsed.src ?? '', alt: parsed.alt ?? '' });
    const cur = tryJson<{ src?: string; alt?: string }>(extracted, { src: '', alt: '' });
    return JSON.stringify({ src: metaDefault, alt: cur.alt ?? '' });
  }
  return metaDefault;
}

function tryJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 按区段类型从 HTML 片段中提取初始值
 * text → 首元素文本；image → src；link → href；color → style 内 prop 值
 * richtext/html → 首元素 inner HTML；list → li 文本项（JSON 数组）
 * video/audio → JSON {src,poster?,controls}；button → 文本
 * divider → JSON {style,color}；spacer → 高度 px
 * input → JSON {type,placeholder,value}；textarea → JSON {placeholder,value}
 * select → JSON {options,value}；checkbox → JSON {checked,label}
 */
function extractValueByType(html: string, type: EditableType, prop?: string): string {
  switch (type) {
    case 'image':
      // JSON {src, alt}：地址与替代文字均可编辑
      return JSON.stringify({ src: extractAttrValue(html, 'src') ?? '', alt: extractAttrValue(html, 'alt') ?? '' });
    case 'link':
      // JSON {href, text}：链接地址与链接文字均可编辑
      return JSON.stringify({ href: extractAttrValue(html, 'href') ?? '', text: extractTextValue(html) });
    case 'color':
      return extractStyleProp(html, prop || 'color') ?? '';
    case 'richtext':
    case 'html':
      return extractInnerHtml(html);
    case 'list':
      return JSON.stringify(extractLiTexts(html));
    case 'video': {
      const src = extractAttrValue(html, 'src') ?? '';
      const poster = extractAttrValue(html, 'poster') ?? '';
      const controls = /\scontrols\b/.test(html);
      return JSON.stringify({ src, poster, controls });
    }
    case 'audio': {
      const src = extractAttrValue(html, 'src') ?? '';
      const controls = /\scontrols\b/.test(html);
      return JSON.stringify({ src, controls });
    }
    case 'button':
      return extractTextValue(html);
    case 'divider': {
      const style = extractAttrValue(html, 'style') ?? '';
      const color = extractStyleProp(html, 'border-color') ?? extractStyleProp(html, 'background-color') ?? '';
      return JSON.stringify({ style, color });
    }
    case 'spacer':
      return extractStyleProp(html, 'height') ?? '20px';
    case 'input': {
      const inputType = extractAttrValue(html, 'type') ?? 'text';
      const placeholder = extractAttrValue(html, 'placeholder') ?? '';
      const value = extractAttrValue(html, 'value') ?? '';
      return JSON.stringify({ type: inputType, placeholder, value });
    }
    case 'textarea': {
      const placeholder = extractAttrValue(html, 'placeholder') ?? '';
      const value = extractInnerHtml(html);
      return JSON.stringify({ placeholder, value });
    }
    case 'select': {
      const options: { label: string; value: string }[] = [];
      for (const m of html.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)) {
        options.push({ value: m[1], label: m[2].replace(/<[^>]+>/g, '').trim() });
      }
      const value = extractAttrValue(html, 'value') ?? '';
      return JSON.stringify({ options, value });
    }
    case 'checkbox': {
      const checked = /\schecked\b/.test(html);
      const label = extractTextValue(html);
      return JSON.stringify({ checked, label });
    }
    case 'custom-css':
      return JSON.stringify(extractAllStyleProps(html));
    default:
      return extractTextValue(html);
  }
}

// 提取所有 <li> 的纯文本项（list 类型初始值）
function extractLiTexts(html: string): string[] {
  const items: string[] = [];
  for (const m of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    items.push(m[1].replace(/<[^>]+>/g, '').trim());
  }
  return items;
}

/**
 * 给首个开标签注入 data-wt-rid 属性
 */
function injectRidOnFirstElement(html: string, rid: string): string {
  return html.replace(/<([a-zA-Z][\w-]*)([^>]*)>/, (fullMatch, tag, attrs) => {
    if (attrs.includes('data-wt-rid=')) return fullMatch;
    return `<${tag}${attrs} data-wt-rid="${rid}">`;
  });
}
