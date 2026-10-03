// shared/site-head.ts
// 全站 head 批量默认：一次性应用到所有 HTML 页面——
// 统一 favicon、标题模式（保持/统一/追加后缀）、统一 description、
// Open Graph 社交分享标签（og:title / og:description / og:image）。
// 纯函数、无 DOM/fs 依赖；写盘语义与页面级 page-meta 保持一致（外科正则，不整文档序列化）。

import { relativePageHref } from './template-url';

export type SiteTitleMode = 'keep' | 'replace' | 'suffix';

export interface SiteHeadOptions {
  /** 当前应用页面的站点根 POSIX 路径（用于把根相对路径换算成页面相对路径） */
  page: string;
  /** favicon 引用：undefined=不改动，''=移除，其余=更新/插入（http/data 原样） */
  favicon?: string;
  /** 标题处理模式，默认 keep */
  titleMode?: SiteTitleMode;
  /** replace 模式的统一标题；suffix 模式的后缀文本（如「 - Acme 官网」） */
  titleText?: string;
  /** description：undefined=不改动，''=移除，其余=覆盖 */
  description?: string;
  /** 是否添加/更新 Open Graph 标签 */
  ogEnabled?: boolean;
  /** og:title：留空则跟随各页最终标题 */
  ogTitle?: string;
  /** og:description：留空则跟随各页最终描述 */
  ogDescription?: string;
  /** og:image 引用（根相对路径会按页面深度换算）；留空不处理 */
  ogImage?: string;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function readTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].trim()) : '';
}

function readDescription(html: string): string {
  const m =
    html.match(
      /<meta\s+[^>]*?name\s*=\s*["']description["'][^>]*?content\s*=\s*["']([^"']*)["'][^>]*>/i
    ) ||
    html.match(
      /<meta\s+[^>]*?content\s*=\s*["']([^"']*)["'][^>]*?name\s*=\s*["']description["'][^>]*>/i
    );
  return m ? m[1] : '';
}

/** 外链/特殊协议不做相对路径换算 */
function toPageRelative(page: string, ref: string): string {
  const v = ref.trim();
  if (/^(https?:)?\/\//i.test(v) || v.startsWith('data:') || v.startsWith('//')) return v;
  const rootRel = v.replace(/^\/+/, '');
  return relativePageHref(page, rootRel);
}

/** 计算最终标题；返回 null 表示该页标题不改动 */
function resolveTitle(existing: string, mode: SiteTitleMode, text: string): string | null {
  if (mode === 'replace') {
    const t = text.trim();
    return t ? t : null;
  }
  if (mode === 'suffix') {
    if (!text.trim()) return null; // 空白后缀不应用，但保留前导分隔空格（如「 - Acme」）
    if (!existing) return text.replace(/^\s+/, ''); // 空标题页去掉前导分隔空格
    if (existing.endsWith(text)) return null; // 已含相同后缀，不重复追加
    return existing + text;
  }
  return null;
}

function writeTitle(html: string, title: string): string {
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(
      /<title[^>]*>[\s\S]*?<\/title>/i,
      `<title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>`
    );
  }
  const tag = `  <title>${escapeAttr(title)}</title>\n`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${tag.trimEnd()}`);
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${tag.trimEnd()}\n</head>`);
  }
  return html;
}

const DESC_PATTERN =
  '<meta\\s+[^>]*?name\\s*=\\s*["\']description["\'][^>]*?>|<meta\\s+[^>]*?content\\s*=\\s*["\'][^"\']*["\'][^>]*?name\\s*=\\s*["\']description["\'][^>]*?>';

function writeDescription(html: string, description: string | null): string {
  // null=不动；''=移除；非空=覆盖/插入
  if (description === null) return html;
  const re = new RegExp(DESC_PATTERN, 'gi');
  if (description === '') return html.replace(re, '');
  const tag = `<meta name="description" content="${escapeAttr(description)}" />`;
  const replaced = html.replace(re, tag);
  if (replaced !== html) return replaced;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `  ${tag}\n</head>`);
  return html;
}

const ICON_LINK_PATTERN =
  '<link\\s+[^>]*?rel\\s*=\\s*["\'][^"\']*\\b(?:shortcut\\s+)?icon\\b[^"\']*["\'][^>]*?\\s*\\/?>';

function writeFavicon(html: string, favicon: string | undefined, page: string): string {
  if (favicon === undefined) return html;
  const re = new RegExp(ICON_LINK_PATTERN, 'gi');
  if (favicon === '') return html.replace(re, '');
  const href = toPageRelative(page, favicon);
  if (re.test(html)) {
    // test 推进了 lastIndex，replace 需用全新正则
    const re2 = new RegExp(ICON_LINK_PATTERN, 'gi');
    // 更新已有 link 的 href（无 href 则补）
    return html.replace(re2, (tag) => {
      if (/href\s*=\s*["'][^"']*["']/i.test(tag)) {
        return tag.replace(/href\s*=\s*["'][^"']*["']/i, `href="${escapeAttr(href)}"`);
      }
      return tag.replace(/\s*\/?>$/, ` href="${escapeAttr(href)}" />`);
    });
  }
  if (/<\/head>/i.test(html)) {
    const tag = `<link rel="icon" href="${escapeAttr(href)}" />`;
    return html.replace(/<\/head>/i, `  ${tag}\n</head>`);
  }
  return html;
}

/** upsert <meta property="og:xxx" content="...">（兼容 property/content 两种属性顺序） */
function upsertOgMeta(html: string, property: string, content: string): string {
  if (!content) return html;
  const propRe = new RegExp(
    `<meta\\s+[^>]*?property\\s*=\\s*["']${escapeRegex(property)}["'][^>]*?>`,
    'i'
  );
  const contentFirstRe = new RegExp(
    `<meta\\s+[^>]*?content\\s*=\\s*["'][^"']*["'][^>]*?property\\s*=\\s*["']${escapeRegex(property)}["'][^>]*?>`,
    'i'
  );
  const tag = `<meta property="${property}" content="${escapeAttr(content)}" />`;
  if (propRe.test(html)) return html.replace(propRe, tag);
  if (contentFirstRe.test(html)) return html.replace(contentFirstRe, tag);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `  ${tag}\n</head>`);
  return html;
}

/**
 * 把全站 head 默认项应用到单个页面 HTML。
 * 注意：favicon/ogImage 若给的是站点根相对路径，会按 page 深度换算成页面相对路径，
 * 渲染端约定从根目录选择图片。
 */
export function applySiteHead(html: string, options: SiteHeadOptions): string {
  const {
    page,
    favicon,
    titleMode = 'keep',
    titleText = '',
    description,
    ogEnabled = false,
    ogTitle = '',
    ogDescription = '',
    ogImage = ''
  } = options;

  let result = html;

  // 1. 标题
  const currentTitle = readTitle(result);
  const finalTitle = resolveTitle(currentTitle, titleMode, titleText);
  if (finalTitle !== null) result = writeTitle(result, finalTitle);
  const titleAfter = finalTitle ?? currentTitle;

  // 2. 描述
  result = writeDescription(result, description ?? null);
  const descAfter = description === undefined ? readDescription(result) : description;

  // 3. favicon
  result = writeFavicon(result, favicon, page);

  // 4. Open Graph（og:title/og:description 留空跟随各页最终标题/描述）
  if (ogEnabled) {
    result = upsertOgMeta(result, 'og:title', ogTitle.trim() || titleAfter);
    if (ogDescription.trim() || descAfter) {
      result = upsertOgMeta(result, 'og:description', ogDescription.trim() || descAfter);
    }
    if (ogImage.trim()) {
      result = upsertOgMeta(result, 'og:image', toPageRelative(page, ogImage.trim()));
    }
  }

  return result;
}
