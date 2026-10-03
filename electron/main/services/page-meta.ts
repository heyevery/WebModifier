// electron/main/services/page-meta.ts
// 页面级元信息：<html lang>、<title>、meta description、favicon link
// 外科手术式正则读写，不做整文档序列化，保留模板原 HTML 格式。

import * as fs from 'fs';
import * as path from 'path';
import type { PageMeta } from '@shared/types/region';
import { applySiteHead, type SiteHeadOptions } from '@shared/site-head';
import { getTemplateDir, scanHtmlPages } from './template-manager';

/** 从 HTML 读取页面元信息（缺失字段返回空字符串） */
export function readPageMetaFromHtml(html: string): PageMeta {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(
    /<meta\s+[^>]*?name\s*=\s*["']description["'][^>]*?content\s*=\s*["']([^"']*)["'][^>]*>/i
  ) || html.match(
    /<meta\s+[^>]*?content\s*=\s*["']([^"']*)["'][^>]*?name\s*=\s*["']description["'][^>]*>/i
  );
  const iconMatch = html.match(
    /<link\s+[^>]*?rel\s*=\s*["'][^"']*\b(?:shortcut\s+)?icon\b[^"']*["'][^>]*?>/i
  );
  let favicon = '';
  if (iconMatch) {
    const hrefMatch = iconMatch[0].match(/href\s*=\s*["']([^"']*)["']/i);
    favicon = hrefMatch ? hrefMatch[1] : '';
  }
  const langMatch = html.match(/<html\b[^>]*?\slang\s*=\s*["']([^"']*)["']/i);

  return {
    title: titleMatch ? decodeEntities(titleMatch[1].trim()) : '',
    description: descMatch ? decodeEntities(descMatch[1]) : '',
    favicon,
    lang: langMatch ? langMatch[1] : ''
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 把页面元信息写回 HTML 字符串（纯函数，便于测试）。
 * - title：替换现有 <title>，无则插入 <head> 后
 * - lang：写入/更新 <html lang>；空值移除该属性
 * - description：替换现有 meta，无则插入 </head> 前
 * - favicon：更新 rel=icon / shortcut icon 的 href；空值移除该 link；
 *            有值但无 link 时在 </head> 前插入
 */
export function applyPageMeta(html: string, meta: PageMeta): string {
  let result = html;

  // 1. <html lang>
  if (/<html\b/i.test(result)) {
    if (meta.lang) {
      if (/\slang\s*=\s*["'][^"']*["']/i.test(result.match(/<html\b[^>]*>/i)?.[0] || '')) {
        result = result.replace(/(<html\b[^>]*?\slang\s*=\s*)["'][^"']*["']/i, `$1"${escapeAttr(meta.lang)}"`);
      } else {
        result = result.replace(/<html\b/i, `<html lang="${escapeAttr(meta.lang)}"`);
      }
    } else {
      // 空 lang：移除属性
      result = result.replace(/(<html\b[^>]*?)\s+lang\s*=\s*["'][^"']*["']/i, '$1');
    }
  }

  // 2. <title>
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(result)) {
    result = result.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeText(meta.title)}</title>`);
  } else if (meta.title) {
    const titleTag = `  <title>${escapeText(meta.title)}</title>\n`;
    if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}\n${titleTag.trimEnd()}`);
    } else if (/<html[^>]*>/i.test(result)) {
      result = result.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${titleTag.trimEnd()}\n</head>`);
    }
  }

  // 3. meta description
  const descRegex =
    /<meta\s+[^>]*?name\s*=\s*["']description["'][^>]*?>|<meta\s+[^>]*?content\s*=\s*["'][^"']*["'][^>]*?name\s*=\s*["']description["'][^>]*?>/i;
  if (meta.description) {
    const tag = `<meta name="description" content="${escapeAttr(meta.description)}" />`;
    if (descRegex.test(result)) {
      result = result.replace(descRegex, tag);
    } else if (/<\/head>/i.test(result)) {
      result = result.replace(/<\/head>/i, `  ${tag}\n</head>`);
    }
  } else {
    // 空描述：移除已有 meta
    result = result.replace(descRegex, '');
  }

  // 4. favicon <link rel="icon">
  const iconLinkRegex =
    /<link\s+[^>]*?rel\s*=\s*["'][^"']*\b(?:shortcut\s+)?icon\b[^"']*["'][^>]*?\s*\/?>/i;
  if (meta.favicon) {
    if (iconLinkRegex.test(result)) {
      // 更新已有 link 的 href（无 href 则补）
      result = result.replace(iconLinkRegex, (tag) => {
        if (/href\s*=\s*["'][^"']*["']/i.test(tag)) {
          return tag.replace(/href\s*=\s*["'][^"']*["']/i, `href="${escapeAttr(meta.favicon)}"`);
        }
        return tag.replace(/\s*\/?>$/, ` href="${escapeAttr(meta.favicon)}" />`);
      });
    } else if (/<\/head>/i.test(result)) {
      const tag = `<link rel="icon" href="${escapeAttr(meta.favicon)}" />`;
      result = result.replace(/<\/head>/i, `  ${tag}\n</head>`);
    }
  } else {
    result = result.replace(iconLinkRegex, '');
  }

  return result;
}

/** 读取磁盘上某页面的元信息 */
export async function readPageMeta(templateName: string, page: string): Promise<PageMeta> {
  const html = await fs.promises.readFile(path.join(getTemplateDir(templateName), page), 'utf-8');
  return readPageMetaFromHtml(html);
}

/** 把元信息写入磁盘页面文件，返回写回后的 HTML（调用方负责清缓存与重新解析） */
export async function writePageMeta(
  templateName: string,
  page: string,
  meta: PageMeta
): Promise<void> {
  const filePath = path.join(getTemplateDir(templateName), page);
  const html = await fs.promises.readFile(filePath, 'utf-8');
  await fs.promises.writeFile(filePath, applyPageMeta(html, meta), 'utf-8');
}

/** 全站 head 批量默认：递归所有 HTML 页面，逐页应用并仅在有变化时写盘 */
export async function applySiteHeadToAll(
  templateName: string,
  options: Omit<SiteHeadOptions, 'page'>
): Promise<{ pagesScanned: number; changedPages: number }> {
  const dir = getTemplateDir(templateName);
  const pages = await scanHtmlPages(templateName);
  let changedPages = 0;
  for (const page of pages) {
    const filePath = path.resolve(dir, ...page.split('/'));
    // 防逃逸：页面路径必须落在模板目录内
    const inside = filePath === dir || filePath.startsWith(dir + path.sep);
    if (!inside) continue;
    const html = await fs.promises.readFile(filePath, 'utf-8');
    const next = applySiteHead(html, { ...options, page });
    if (next !== html) {
      await fs.promises.writeFile(filePath, next, 'utf-8');
      changedPages += 1;
    }
  }
  return { pagesScanned: pages.length, changedPages };
}
