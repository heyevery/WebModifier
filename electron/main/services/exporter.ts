// electron/main/services/exporter.ts
// 导出器：在原始 HTML 上做外科手术式剥离 + 值替换
// 严格不使用 cheerio 序列化，避免破坏开发者原 HTML 格式

import type { Region } from '@shared/types/region';
import type { SiteInjections } from '@shared/types/ipc';
import { buildLiHtml, findFirstElementRange, replaceFirstElementInner } from '@shared/element-utils';

/**
 * 导出最终 HTML
 * @param originalHtml 原始模板 HTML（含标记）
 * @param regions 已编辑的 region 列表
 */
export function exportTemplate(originalHtml: string, regions: Region[]): string {
  let result = originalHtml;

  // 应用每个 region 的值
  for (const region of regions) {
    switch (region.type) {
      case 'text':
        if (region.kind === 'block') {
          result = applyBlockText(result, region);
        } else {
          result = applyAttrText(result, region);
        }
        break;
      case 'image': {
        // 新格式 JSON {src, alt}：src 与 alt 都写入（空 alt 移除属性）
        // 旧格式纯字符串：仅替换 src，原 alt 保持不动
        const v = safeJson<{ src?: string; alt?: string } | null>(region.value, null);
        const isJson = v && typeof v === 'object';
        const src = isJson && typeof v.src === 'string' ? v.src : region.value;
        result = applyRegion(result, region, (attrs) => {
          let a = replaceAttrInAttrs(attrs, 'src', src);
          if (isJson) {
            const alt = typeof v.alt === 'string' ? v.alt : '';
            a = alt === '' ? removeAttrInAttrs(a, 'alt') : replaceAttrInAttrs(a, 'alt', alt);
          }
          return a;
        });
        break;
      }
      case 'link': {
        // JSON {href, text}；兼容旧格式纯字符串（仅 href，文字保持原样）
        const v = safeJson<{ href?: string; text?: string } | null>(region.value, null);
        const href = v && typeof v === 'object' && typeof v.href === 'string' ? v.href : region.value;
        const text = v && typeof v === 'object' && typeof v.text === 'string' ? v.text : null;
        // 属性与文字必须在同一次匹配中替换（替换会剥离标记，之后无法二次定位）
        result = region.kind === 'block'
          ? applyBlockLink(result, region, href, text)
          : applyAttrLink(result, region, href, text);
        break;
      }
      case 'color': {
        // 新格式为 JSON { prop, value }（属性面板可切换目标 CSS 属性）；
        // 兼容旧格式：纯颜色字符串 + region.prop
        const parsed = safeJson<{ prop?: string; value?: string } | null>(region.value, null);
        const prop = parsed && typeof parsed === 'object' && parsed.prop
          ? parsed.prop
          : region.prop || 'color';
        const value = parsed && typeof parsed === 'object' && typeof parsed.value === 'string'
          ? parsed.value
          : region.value;
        result = applyRegion(result, region, (attrs) => applyStylePropToAttrs(attrs, prop, value));
        break;
      }
      case 'custom-css': {
        // 值为 JSON { prop: value, ... } → 整体重建 style 属性
        const styles = safeJson<Record<string, string>>(region.value, {});
        result = applyRegion(result, region, (attrs) => replaceStyleInAttrs(attrs, styles));
        break;
      }
      case 'richtext':
      case 'html':
        // 值即首元素 inner HTML，原样写回
        result = applyInnerReplace(result, region, region.value);
        break;
      case 'list':
        // 值为 JSON 数组 → 重建 li 序列（保留原 ul/ol 及属性）
        result = applyInnerReplace(result, region, buildLiHtml(region.value));
        break;
      case 'video': {
        const v = safeJson(region.value, { src: '', poster: '', controls: true });
        result = applyRegion(result, region, (attrs) => {
          let a = replaceAttrInAttrs(attrs, 'src', v.src);
          if (v.poster) a = replaceAttrInAttrs(a, 'poster', v.poster);
          a = toggleBooleanAttr(a, 'controls', v.controls);
          return a;
        });
        break;
      }
      case 'audio': {
        const v = safeJson(region.value, { src: '', controls: true });
        result = applyRegion(result, region, (attrs) => {
          let a = replaceAttrInAttrs(attrs, 'src', v.src);
          a = toggleBooleanAttr(a, 'controls', v.controls);
          return a;
        });
        break;
      }
      case 'button':
        if (region.kind === 'block') {
          result = applyBlockText(result, region);
        } else {
          result = applyAttrText(result, region);
        }
        break;
      case 'divider': {
        const v = safeJson(region.value, { style: '', color: '' });
        result = applyRegion(result, region, (attrs) => {
          if (v.color) return applyStylePropToAttrs(attrs, 'border-color', v.color);
          return attrs;
        });
        break;
      }
      case 'spacer': {
        const height = region.value || '20px';
        result = applyRegion(result, region, (attrs) =>
          applyStylePropToAttrs(attrs, 'height', height)
        );
        break;
      }
      case 'input': {
        const v = safeJson(region.value, { type: 'text', placeholder: '', value: '' });
        result = applyRegion(result, region, (attrs) => {
          let a = replaceAttrInAttrs(attrs, 'type', v.type);
          a = replaceAttrInAttrs(a, 'placeholder', v.placeholder);
          a = replaceAttrInAttrs(a, 'value', v.value);
          return a;
        });
        break;
      }
      case 'textarea': {
        const v = safeJson(region.value, { placeholder: '', value: '' });
        result = applyRegion(result, region, (attrs) =>
          replaceAttrInAttrs(attrs, 'placeholder', v.placeholder)
        );
        result = applyInnerReplace(result, region, escapeHtml(v.value));
        break;
      }
      case 'select': {
        const v = safeJson(region.value, { options: [] as { label: string; value: string }[], value: '' });
        const optionsHtml = (v.options || [])
          .map(
            (o: { label: string; value: string }) =>
              `<option value="${escapeHtmlAttr(o.value)}"${
                o.value === v.value ? ' selected' : ''
              }>${escapeHtml(o.label)}</option>`
          )
          .join('');
        result = applyInnerReplace(result, region, optionsHtml);
        break;
      }
      case 'checkbox': {
        const v = safeJson(region.value, { checked: false, label: '' });
        result = applyRegion(result, region, (attrs) => toggleBooleanAttr(attrs, 'checked', v.checked));
        break;
      }
      default:
        break;
    }
  }

  // 最终清理：剥离所有残留标记与属性
  result = stripAllMarkers(result);

  return result;
}

/**
 * 把全站自定义代码注入已导出的 HTML（无标记的最终页）：
 * body 代码插到 </body> 前；head 代码插到 </head> 前。
 * 缺对应标签的极端 HTML 退化为追加/前置，保证代码不丢失。代码原样插入，不做转义。
 */
export function injectSiteCode(html: string, injections?: SiteInjections): string {
  const bodyCode = (injections?.body ?? '').trim();
  const headCode = (injections?.head ?? '').trim();
  let result = html;

  if (bodyCode) {
    if (/<\/body\s*>/i.test(result)) {
      result = result.replace(/<\/body\s*>/i, (m) => `${bodyCode}\n${m}`);
    } else {
      result = `${result}\n${bodyCode}\n`;
    }
  }

  if (headCode) {
    if (/<\/head\s*>/i.test(result)) {
      result = result.replace(/<\/head\s*>/i, (m) => `${headCode}\n${m}`);
    } else if (/<body\b/i.test(result)) {
      // 有 body 无 head：插到 <body> 前
      result = result.replace(/<body\b/i, (m) => `${headCode}\n${m}`);
    } else {
      result = `${headCode}\n${result}`;
    }
  }

  return result;
}

/** 按 region 类型返回块注释标记名 / 单元素属性标记名（公共区为 @wt:shared / data-wt-shared） */
function blockMarker(region: Region): string {
  return region.shared ? '@wt:shared' : '@wt:edit';
}

function attrMarker(region: Region): string {
  return region.shared ? 'data-wt-shared' : 'data-wt-edit';
}

/** 构造定位块标记（含 inner 捕获）的正则 */
function blockMatchRegex(region: Region): RegExp {
  const idPattern = escapeRegex(region.id);
  const tag = blockMarker(region);
  return new RegExp(
    `<!--\\s*${tag}\\s+name="${idPattern}"[^>]*-->([\\s\\S]*?)<!--\\s*\\/${tag}\\s*-->`
  );
}

/** attr 标记元素的定位结果（inner 范围按标签深度计数，兼容嵌套同名/异名标签） */
interface AttrElementMatch {
  openStart: number;
  openEnd: number;
  tagName: string;
  /** 去掉 data-wt-* 标记属性后的开标签属性串（保留前导空白） */
  cleanAttrs: string;
  selfClose: boolean;
  innerStart?: number;
  innerEnd?: number;
}

/** 定位带标记属性的开标签；非自闭合元素再计算 inner 范围 */
function matchAttrElement(html: string, idPattern: string, marker: string): AttrElementMatch | null {
  const attrOpenRegex = new RegExp(
    `(<([a-zA-Z][\\w-]*))([^>]*?)(\\s+${marker}="${idPattern}"(?:\\s+data-wt-type="[^"]+")?(?:\\s+data-wt-label="[^"]+")?(?:\\s+data-wt-prop="[^"]+")?)([^>]*?)(\\/?)>`
  );
  const m = attrOpenRegex.exec(html);
  if (!m || m.index === undefined) return null;
  const openStart = m.index;
  const match: AttrElementMatch = {
    openStart,
    openEnd: openStart + m[0].length,
    tagName: m[2],
    cleanAttrs: m[3] + m[5],
    selfClose: m[6] === '/'
  };
  if (!match.selfClose) {
    const range = findFirstElementRange(html.slice(openStart));
    if (range) {
      match.innerStart = openStart + range.innerStart;
      match.innerEnd = openStart + range.innerEnd;
    }
  }
  return match;
}

/**
 * inner 内容替换（richtext/html/list 共用）
 * block → 替换内层首元素的 inner（保留元素及属性）
 * attr → 剥离 data-wt-* 标记属性，替换元素 inner
 */
function applyInnerReplace(html: string, region: Region, newInner: string): string {
  if (region.kind === 'block') {
    return html.replace(blockMatchRegex(region), (_, innerHtml: string) =>
      replaceFirstElementInner(innerHtml, newInner)
    );
  }
  const m = matchAttrElement(html, escapeRegex(region.id), attrMarker(region));
  if (!m || m.innerStart === undefined || m.innerEnd === undefined) return html;
  return (
    html.slice(0, m.openStart) +
    `<${m.tagName}${m.cleanAttrs}>` +
    newInner +
    html.slice(m.innerEnd)
  );
}

/**
 * 通用属性替换：block → 改内层首元素；attr → 改元素本身
 */
function applyRegion(html: string, region: Region, transformAttrs: (attrs: string) => string): string {
  if (region.kind === 'block') {
    return html.replace(blockMatchRegex(region), (_, innerHtml: string) =>
      // 只改首个元素的开标签属性
      innerHtml.replace(/<([a-zA-Z][\w-]*)([^>]*)>/, (_full: string, tag: string, attrs: string) =>
        `<${tag}${transformAttrs(attrs)}>`
      )
    );
  }
  // attr kind：定位标记元素开标签，剥离 data-wt-*，替换目标属性
  // 只替换开标签部分（inner/闭合原样保留），天然支持 <input>/<img>/<hr> 等 void 元素
  const m = matchAttrElement(html, escapeRegex(region.id), attrMarker(region));
  if (!m) return html;
  return (
    html.slice(0, m.openStart) +
    `<${m.tagName}${transformAttrs(m.cleanAttrs)}${m.selfClose ? '/>' : '>'}` +
    html.slice(m.openEnd)
  );
}

/**
 * 在开标签属性串中替换 attr="value"；不存在则追加
 */
function replaceAttrInAttrs(attrs: string, attrName: string, value: string): string {
  const quoted = escapeHtmlAttr(value);
  const re = new RegExp(`\\s${attrName}\\s*=\\s*"[^"]*"`);
  if (re.test(attrs)) {
    return attrs.replace(re, ` ${attrName}="${quoted}"`);
  }
  const re2 = new RegExp(`\\s${attrName}\\s*=\\s*'[^']*'`);
  if (re2.test(attrs)) {
    return attrs.replace(re2, ` ${attrName}="${quoted}"`);
  }
  return `${attrs} ${attrName}="${quoted}"`;
}

/**
 * 从开标签属性串中移除指定属性（不存在则原样返回）
 */
function removeAttrInAttrs(attrs: string, attrName: string): string {
  return attrs
    .replace(new RegExp(`\\s${attrName}\\s*=\\s*"[^"]*"`), '')
    .replace(new RegExp(`\\s${attrName}\\s*=\\s*'[^']*'`), '');
}

/**
 * 用 { prop: value } 对象整体重建 style 属性（custom-css 导出用）；空对象则移除 style
 */
function replaceStyleInAttrs(attrs: string, styles: Record<string, string>): string {
  const entries = Object.entries(styles).filter(([, v]) => v !== '');
  const newStyle = entries.map(([k, v]) => `${k}: ${v}`).join('; ');
  const hasStyle = /\sstyle\s*=\s*"[^"]*"/.test(attrs) || /\sstyle\s*=\s*'[^']*'/.test(attrs);
  if (!newStyle) {
    // 无有效属性：移除已有 style
    return attrs
      .replace(/\sstyle\s*=\s*"[^"]*"/, '')
      .replace(/\sstyle\s*=\s*'[^']*'/, '');
  }
  if (!hasStyle) {
    return `${attrs} style="${escapeHtmlAttr(newStyle)}"`;
  }
  return attrs
    .replace(/\sstyle\s*=\s*"[^"]*"/, ` style="${escapeHtmlAttr(newStyle)}"`)
    .replace(/\sstyle\s*=\s*'[^']*'/, ` style="${escapeHtmlAttr(newStyle)}"`);
}

/**
 * 在开标签属性串的 style 内设置 CSS 属性；无 style 则新增
 */
function applyStylePropToAttrs(attrs: string, prop: string, value: string): string {
  const styleMatch = attrs.match(/\sstyle\s*=\s*"([^"]*)"/);
  if (!styleMatch) {
    return `${attrs} style="${escapeHtmlAttr(`${prop}: ${value}`)}"`;
  }
  const style = styleMatch[1];
  const propRe = new RegExp(`(${prop}\\s*:\\s*)([^;]+)`, 'i');
  let newStyle: string;
  if (propRe.test(style)) {
    newStyle = style.replace(propRe, `$1${value}`);
  } else {
    newStyle = style.trimEnd().endsWith(';') ? `${style} ${prop}: ${value}` : `${style}; ${prop}: ${value}`;
  }
  return attrs.replace(/\sstyle\s*=\s*"[^"]*"/, ` style="${escapeHtmlAttr(newStyle)}"`);
}

/**
 * 处理块级 link 区域：单次匹配内同时替换首元素 href 与其文字
 * （applyRegion 会剥离块注释，无法再靠标记二次定位，故必须一次完成）
 */
function applyBlockLink(
  html: string,
  region: Region,
  href: string,
  text: string | null
): string {
  return html.replace(blockMatchRegex(region), (_, innerHtml: string) => {
    let next = innerHtml.replace(
      /<([a-zA-Z][\w-]*)([^>]*)>/,
      (full: string, tag: string, attrs: string) =>
        `<${tag}${replaceAttrInAttrs(attrs, 'href', href)}>`
    );
    if (text !== null) next = replaceTextInElement(next, text);
    return next;
  });
}

/**
 * 处理属性 link 区域：单次匹配内同时替换 href（剥离 data-wt-*）与元素文字
 */
function applyAttrLink(
  html: string,
  region: Region,
  href: string,
  text: string | null
): string {
  const m = matchAttrElement(html, escapeRegex(region.id), attrMarker(region));
  if (!m || m.innerStart === undefined || m.innerEnd === undefined) return html;
  const inner = html.slice(m.innerStart, m.innerEnd);
  const newAttrs = replaceAttrInAttrs(m.cleanAttrs, 'href', href);
  const newInner = text !== null ? replaceTextInElement(inner, text) : inner;
  return (
    html.slice(0, m.openStart) +
    `<${m.tagName}${newAttrs}>` +
    newInner +
    html.slice(m.innerEnd)
  );
}

/**
 * 处理块级 text 区域：剥离首尾注释，替换 inner 中的文本
 */
function applyBlockText(html: string, region: Region): string {
  return html.replace(blockMatchRegex(region), (_, innerHtml) => {
    return replaceTextInElement(innerHtml, region.value);
  });
}

/**
 * 处理属性 text 区域：剥离 data-wt-* 属性，替换 inner 文本
 */
function applyAttrText(html: string, region: Region): string {
  const m = matchAttrElement(html, escapeRegex(region.id), attrMarker(region));
  if (!m || m.innerStart === undefined || m.innerEnd === undefined) return html;
  const inner = html.slice(m.innerStart, m.innerEnd);
  const newInner = replaceTextInElement(inner, region.value);
  return (
    html.slice(0, m.openStart) +
    `<${m.tagName}${m.cleanAttrs}>` +
    newInner +
    html.slice(m.innerEnd)
  );
}

/**
 * 在 HTML 片段中替换首个文本节点
 * Phase 1 限定：仅支持 <el ...>text</el> 单层结构
 */
function replaceTextInElement(html: string, newText: string): string {
  // 匹配首个开标签 + 文本 + 闭标签
  const m = html.match(/(<[a-zA-Z][\w-]*[^>]*>)([^<]*)(<\/[a-zA-Z][\w-]*>)/);
  if (m) {
    return html.replace(m[0], `${m[1]}${escapeHtml(newText)}${m[3]}`);
  }
  // 纯文本场景
  return escapeHtml(newText);
}

/**
 * 剥离所有 wt 标记与属性
 */
function stripAllMarkers(html: string): string {
  let result = html;
  result = result.replace(/<!--\s*@wt:edit[^>]*-->\s*/g, '');
  result = result.replace(/\s*<!--\s*\/@wt:edit\s*-->/g, '');
  result = result.replace(/<!--\s*@wt:shared[^>]*-->\s*/g, '');
  result = result.replace(/\s*<!--\s*\/@wt:shared\s*-->/g, '');
  result = result.replace(/\s+data-wt-edit(?:="[^"]*")?/g, '');
  result = result.replace(/\s+data-wt-shared(?:="[^"]*")?/g, '');
  result = result.replace(/\s+data-wt-type(?:="[^"]*")?/g, '');
  result = result.replace(/\s+data-wt-label(?:="[^"]*")?/g, '');
  result = result.replace(/\s+data-wt-rid(?:="[^"]*")?/g, '');
  result = result.replace(/\s+data-wt-prop(?:="[^"]*")?/g, '');
  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 安全解析 JSON 值，失败时返回默认值 */
function safeJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 在属性串中切换布尔属性（controls/checked 等）的存在与否 */
function toggleBooleanAttr(attrs: string, attrName: string, on: boolean): string {
  const re = new RegExp(`\\s${attrName}\\b`);
  const has = re.test(attrs);
  if (on && !has) return `${attrs} ${attrName}`;
  if (!on && has) return attrs.replace(re, '');
  return attrs;
}
