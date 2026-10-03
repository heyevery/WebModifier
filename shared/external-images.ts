// shared/external-images.ts
// 外链图片本地化（#10④）：在工作区 HTML 页面与 CSS 文件中收集 http(s)/协议相对的
// 图片引用（img/source src、srcset、video poster、<style>/style 属性与 CSS 文件内的 url()），
// 并提供确定性文件命名与「URL 字面量 → 本地相对路径」的重写原语。
// 纯函数：无 DOM / fs / Electron 依赖，可直接单测。

import { relativePageHref } from './template-url';

/** 本地化图片在模板根下的统一存放目录（POSIX） */
export const EXTERNAL_IMAGES_DIR = 'assets/external';

export type ExternalRefKind = 'html' | 'css';

export interface ExternalImageLocation {
  /** 页面或 CSS 文件相对模板根的 POSIX 路径 */
  source: string;
  kind: ExternalRefKind;
}

export interface ExternalImage {
  /** 规范化后的下载 URL（https，去 hash） */
  url: string;
  /** 命中总次数（含同一文件内多处） */
  occurrences: number;
  locations: ExternalImageLocation[];
}

export interface ExternalImageFiles {
  /** 页面 POSIX 路径 → HTML 文本 */
  html?: Record<string, string>;
  /** CSS 文件 POSIX 路径 → CSS 文本 */
  css?: Record<string, string>;
}

/** 单张图片本地化成功明细（主进程下载完成后产出） */
export interface LocalizedImageItem {
  url: string;
  /** 相对模板根的 POSIX 路径，如 assets/external/img-ab12.jpg */
  sitePath: string;
  fileName: string;
  bytes: number;
  /** 引用被改写的文件（页面/CSS，POSIX 路径） */
  files: string[];
}

/** 下载/校验失败明细：外链原样保留，不替换引用（三态策略的失败态） */
export interface FailedImageItem {
  url: string;
  reason: string;
}

/** 一次本地化批次的产物报告 */
export interface LocalizeImageReport {
  localized: LocalizedImageItem[];
  failed: FailedImageItem[];
  changedHtml: string[];
  changedCss: string[];
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)(?:$|[?#])/i;
/** 明确不是图片的资源扩展名（字体/音视频/脚本/样式表） */
const NON_IMAGE_EXT_RE =
  /\.(woff2?|ttf|otf|eot|mp4|webm|mov|m4v|ogv|mpeg|mpg|avi|mp3|wav|aac|flac|ogg|oga|m3u8|css|js|mjs|json|html?)(?:$|[?#])/i;

/** 是否为外部网络引用：http(s):// 或协议相对 //（data:/blob:/file: 均不算） */
export function isExternalUrl(ref: string): boolean {
  const v = ref.trim();
  return /^https?:\/\//i.test(v) || v.startsWith('//');
}

/**
 * 按 URL 形态猜测是否图片：
 * - 图片扩展名 → 是；字体/媒体/脚本等扩展名 → 否
 * - 无扩展名（如 https://picsum.photos/seed/x/1200/560）→ 是，下载后以 Content-Type 复核
 */
export function looksLikeImageUrl(url: string): boolean {
  if (IMAGE_EXT_RE.test(url)) return true;
  if (NON_IMAGE_EXT_RE.test(url)) return false;
  return true;
}

/**
 * 归一化外链：trim、协议相对补 https:、去 hash；非 http(s) 外链返回 null。
 * 保留 query（图床常用尺寸/裁剪参数）。
 */
export function normalizeExternalUrl(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (v.startsWith('//')) v = `https:${v}`;
  if (!/^https?:\/\//i.test(v)) return null;
  const hashIdx = v.indexOf('#');
  if (hashIdx >= 0) v = v.slice(0, hashIdx);
  return v;
}

/** 同一资源 URL 的常见书写形态（https/http/协议相对），重写时逐个字面量替换 */
export function urlVariants(url: string): string[] {
  const https = url.replace(/^http:\/\//i, 'https://');
  const variants = new Set<string>([https]);
  variants.add(https.replace(/^https:\/\//i, 'http://'));
  const hostPath = https.replace(/^https:\/\//i, '');
  variants.add(`//${hostPath}`);
  return [...variants];
}

/** djb2 哈希 → 正整数 base36（同一 URL 稳定同名，天然去重/幂等） */
function hashBase36(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** 本地资源文件名主干（不含扩展名），如 img-e4p2k9 */
export function assetFileBase(url: string): string {
  return `img-${hashBase36(url)}`;
}

/** Content-Type → 图片扩展名；非图片类型返回 null */
export function extFromContentType(contentType: string): string | null {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  switch (ct) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/avif':
      return 'avif';
    case 'image/svg+xml':
    case 'image/svg':
      return 'svg';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
    case 'image/icon':
      return 'ico';
    case 'image/bmp':
    case 'image/x-bmp':
      return 'bmp';
    default:
      return null;
  }
}

/** 从 URL 路径名取白名单内图片扩展名（小写，无点），否则 null */
export function imageExtFromUrl(url: string): string | null {
  let pathname = url;
  const qIdx = pathname.search(/[?#]/);
  if (qIdx >= 0) pathname = pathname.slice(0, qIdx);
  const m = /\.([a-z0-9]+)$/i.exec(pathname);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return null;
}

/** 决定最终扩展名：Content-Type 优先（图床无扩展名时），退回 URL 扩展名；都不可用返回 '' */
export function resolveImageExt(url: string, contentType?: string | null): string {
  if (contentType) {
    const fromCt = extFromContentType(contentType);
    if (fromCt) return fromCt;
  }
  return imageExtFromUrl(url) ?? '';
}

/** 站点根相对资源路径，如 assets/external/img-ab12.jpg */
export function assetSitePath(fileName: string): string {
  return `${EXTERNAL_IMAGES_DIR}/${fileName}`;
}

/**
 * 生成从某页面/CSS 文件所在目录到站点根资源的浏览器相对引用。
 * 例：('index.html', 'assets/external/x.jpg') → 'assets/external/x.jpg'
 *     ('sub/style.css', 'assets/external/x.jpg') → '../assets/external/x.jpg'
 */
export function relativeAssetRef(fromFile: string, sitePath: string): string {
  return relativePageHref(fromFile, sitePath);
}

// ---------------- 收集 ----------------

function attrValues(tag: string, attr: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\s${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out.push((m[1] ?? m[2] ?? '').trim());
  return out;
}

/** 解析 srcset：逗号分隔的「URL [描述符]」，取每段首个空白前的 URL */
export function parseSrcset(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean);
}

const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)/gi;

/** 抽取 CSS 文本中所有外链图片 url()（字体/媒体/样式表扩展名排除） */
export function extractCssImageUrls(cssText: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  CSS_URL_RE.lastIndex = 0;
  while ((m = CSS_URL_RE.exec(cssText))) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (raw && isExternalUrl(raw) && looksLikeImageUrl(raw)) out.push(raw);
  }
  return out;
}

/** 抽取单个 HTML 页面中的全部外链图片 URL */
export function extractHtmlImageUrls(html: string): string[] {
  const out: string[] = [];
  const push = (raw: string): void => {
    if (raw && isExternalUrl(raw) && looksLikeImageUrl(raw)) out.push(raw);
  };

  // <img>/<source>/<video> 开标签
  const tagRe = /<(img|source|video)\b[^>]*>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(html))) {
    const tagName = tm[1].toLowerCase();
    const tag = tm[0];
    if (tagName === 'video') {
      attrValues(tag, 'poster').forEach(push);
    } else {
      attrValues(tag, 'src').forEach(push);
      attrValues(tag, 'srcset').forEach((v) => parseSrcset(v).forEach(push));
    }
  }

  // <style> 块内 url()
  const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = styleBlockRe.exec(html))) {
    extractCssImageUrls(sm[1] ?? '').forEach((u) => out.push(u));
  }

  // 元素 style 属性内 url()
  const styleAttrRe = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let am: RegExpExecArray | null;
  while ((am = styleAttrRe.exec(html))) {
    extractCssImageUrls(am[1] ?? am[2] ?? '').forEach((u) => out.push(u));
  }

  return out;
}

/**
 * 跨全部 HTML/CSS 文件收集外链图片，按规范化 URL 去重聚合（保持首次发现顺序）。
 */
export function collectExternalImages(files: ExternalImageFiles): ExternalImage[] {
  const order: string[] = [];
  const map = new Map<
    string,
    { occurrences: number; locations: Map<string, ExternalImageLocation> }
  >();

  const add = (rawUrl: string, location: ExternalImageLocation): void => {
    const url = normalizeExternalUrl(rawUrl);
    if (!url || !looksLikeImageUrl(url)) return;
    let entry = map.get(url);
    if (!entry) {
      entry = { occurrences: 0, locations: new Map() };
      map.set(url, entry);
      order.push(url);
    }
    entry.occurrences += 1;
    const locKey = `${location.kind}:${location.source}`;
    if (!entry.locations.has(locKey)) entry.locations.set(locKey, location);
  };

  for (const [page, text] of Object.entries(files.html ?? {})) {
    for (const u of extractHtmlImageUrls(text)) add(u, { source: page, kind: 'html' });
  }
  for (const [cssPath, text] of Object.entries(files.css ?? {})) {
    for (const u of extractCssImageUrls(text)) add(u, { source: cssPath, kind: 'css' });
  }

  return order.map((url) => {
    const entry = map.get(url)!;
    return { url, occurrences: entry.occurrences, locations: [...entry.locations.values()] };
  });
}

// ---------------- 重写 ----------------

export interface ExternalUrlReplacement {
  /** 规范化外链 URL */
  url: string;
  /** 已按目标文件目录换算好的本地相对引用 */
  localRef: string;
}

/**
 * 在一份 HTML/CSS 文本中把外链的所有书写形态（https/http/协议相对）字面量替换为本地引用。
 * 字面量替换不依赖正则，URL 中的 . ? + 等字符无需转义；无命中时返回原串。
 */
export function rewriteExternalRefs(
  text: string,
  replacements: readonly ExternalUrlReplacement[]
): string {
  let next = text;
  for (const { url, localRef } of replacements) {
    if (!localRef) continue;
    for (const variant of urlVariants(url)) {
      if (variant && next.includes(variant)) next = next.split(variant).join(localRef);
    }
  }
  return next;
}
