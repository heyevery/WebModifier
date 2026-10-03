// shared/health-check.ts
// 导出前健康扫描（纯函数）：在「与导出一致的最终 HTML」上检测
//  - 站内死链（<a href> 指向不存在的页面/文件）
//  - 缺失图片/媒体（img/source/video/audio 的相对 src、video poster）
//  - 空 <title> / 缺 meta description（warning）
// 文件是否真正存在由主进程拿到 assets 清单后用 fs 校验，纯逻辑层不碰文件系统。

import { resolvePagePath, resolveKnownPage } from './template-url';

export type HealthSeverity = 'error' | 'warning';

export type HealthCode =
  | 'broken-link'
  | 'missing-image'
  | 'empty-title'
  | 'empty-description';

export interface HealthIssue {
  /** POSIX 相对站点根的页面路径，如 about/index.html */
  page: string;
  code: HealthCode;
  severity: HealthSeverity;
  /** 面向用户的说明（含出问题的引用） */
  message: string;
}

/** 待主进程做存在性校验的站内资源引用 */
export interface PendingAsset {
  page: string;
  /** image=img/source/poster；media=video/audio；file=<a> 指向的非页面文件 */
  kind: 'image' | 'media' | 'file';
  /** 原始引用值，用于报错文案 */
  ref: string;
  /** 解析到站点根的 POSIX 路径（去 query/hash） */
  resolved: string;
}

export interface PageHealth {
  issues: HealthIssue[];
  assets: PendingAsset[];
}

/** 外部/特殊协议引用：http(s)、协议相对、data、mailto/tel/sms/javascript、纯锚点 */
export function isExternalRef(ref: string): boolean {
  const v = ref.trim();
  if (!v) return true;
  if (v.startsWith('#')) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith('/')) return true; // http:/data:/mailto:/tel: …
  if (v.startsWith('//')) return true;
  return false;
}

/** 去掉 ref 上的 query/hash，解析为站点根 POSIX 路径 */
function toSitePath(currentPage: string, ref: string): string {
  return resolvePagePath(currentPage, ref);
}

/** 像页面链接：目录式（/ 结尾）、.html/.htm、无扩展名 */
function looksLikePage(ref: string): boolean {
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean || clean.endsWith('/')) return true;
  const last = clean.split('/').pop() ?? '';
  if (/\.(html?|htm)$/i.test(last)) return true;
  return !last.includes('.');
}

function attrValues(tag: string, attr: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\s${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out.push((m[1] ?? m[2] ?? '').trim());
  return out;
}

/**
 * 扫描单个最终页面。
 * @param page       当前页站点根相对 POSIX 路径
 * @param html       应用编辑后的最终 HTML（与导出内容一致）
 * @param knownPages 站内全部页面（POSIX）
 */
export function scanPageHealth(
  page: string,
  html: string,
  knownPages: readonly string[]
): PageHealth {
  const issues: HealthIssue[] = [];
  const assets: PendingAsset[] = [];

  // ---- head 元信息 ----
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch || !titleMatch[1].trim()) {
    issues.push({
      page,
      code: 'empty-title',
      severity: 'warning',
      message: '页面标题 <title> 为空'
    });
  }
  const hasDesc =
    /<meta\s+[^>]*?name\s*=\s*["']description["'][^>]*?content\s*=\s*["'][^"']+["'][^>]*>/i.test(
      html
    ) ||
    /<meta\s+[^>]*?content\s*=\s*["'][^"']+["'][^>]*?name\s*=\s*["']description["'][^>]*>/i.test(
      html
    );
  if (!hasDesc) {
    issues.push({
      page,
      code: 'empty-description',
      severity: 'warning',
      message: '缺少 meta description（或内容为空）'
    });
  }

  // ---- <a href> 站内链接 ----
  const anchorRe = /<a\b[^>]*>/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(html))) {
    const tag = am[0];
    for (const href of attrValues(tag, 'href')) {
      if (!href || isExternalRef(href)) continue;
      if (looksLikePage(href)) {
        if (!resolveKnownPage(page, href, knownPages)) {
          issues.push({
            page,
            code: 'broken-link',
            severity: 'error',
            message: `链接指向不存在的页面：${href}`
          });
        }
      } else {
        assets.push({ page, kind: 'file', ref: href, resolved: toSitePath(page, href) });
      }
    }
  }

  // ---- 图片/媒体 ----
  const mediaRe = /<(img|source|video|audio)\b[^>]*>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = mediaRe.exec(html))) {
    const tagName = mm[1].toLowerCase();
    const tag = mm[0];
    const srcs = attrValues(tag, 'src');
    const posters = tagName === 'video' ? attrValues(tag, 'poster') : [];
    const kind: PendingAsset['kind'] = tagName === 'img' || tagName === 'source' ? 'image' : 'media';
    for (const ref of [...srcs, ...posters]) {
      if (!ref || isExternalRef(ref)) continue;
      // poster 固定按图片归类
      const k: PendingAsset['kind'] = posters.includes(ref) ? 'image' : kind;
      assets.push({ page, kind: k, ref, resolved: toSitePath(page, ref) });
    }
  }

  return { issues, assets };
}

/**
 * 主进程 fs 校验后，把缺失资源转成对应问题项。
 * @param asset      扫描出的资源引用
 * @param exists     磁盘上是否存在
 */
export function missingAssetIssue(asset: PendingAsset, exists: boolean): HealthIssue | null {
  if (exists) return null;
  if (asset.kind === 'file') {
    return {
      page: asset.page,
      code: 'broken-link',
      severity: 'error',
      message: `链接指向的文件不存在：${asset.ref}`
    };
  }
  return {
    page: asset.page,
    code: 'missing-image',
    severity: 'error',
    message: `${asset.kind === 'media' ? '媒体' : '图片'}文件缺失：${asset.ref}`
  };
}

/** 统计辅助 */
export function summarizeIssues(issues: readonly HealthIssue[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const i of issues) {
    if (i.severity === 'error') errors++;
    else warnings++;
  }
  return { errors, warnings };
}
