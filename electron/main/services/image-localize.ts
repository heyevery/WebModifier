// electron/main/services/image-localize.ts
// 外链图片本地化（#10④）主进程能力：
//  1. 扫描工作区全部 HTML 页面与 CSS 文件中的外链图片（纯逻辑收集在 @shared/external-images）
//  2. 经 Electron net.fetch 下载（跟随重定向、超时/大小/类型校验）到模板目录
//     assets/external/img-<urlhash>.<ext>（同一 URL 稳定同名，天然幂等去重）
//  3. 把各文件中的外链字面量改写为页面/CSS 相对路径并写盘（仅改动的文件写回）
// 下载失败的链接原样保留并在报告中列明原因（三态策略：成功本地化 / 失败保留 / 未选择）。
// 与 copyImageToTemplate / page-meta 一致：二进制资源与磁盘文本改写属于工作区落盘内容，
// .wt-original 原件快照不动，导出时随 copyAssets 全量拷贝。

import * as fs from 'fs';
import * as path from 'path';
import { net } from 'electron';
import {
  EXTERNAL_IMAGES_DIR,
  assetFileBase,
  assetSitePath,
  collectExternalImages,
  extFromContentType,
  imageExtFromUrl,
  relativeAssetRef,
  rewriteExternalRefs,
  type ExternalImage,
  type FailedImageItem,
  type LocalizeImageReport,
  type LocalizedImageItem
} from '@shared/external-images';
import { getTemplateDir, scanHtmlPages } from './template-manager';
import { listCssFiles } from './css-parser';

/** 单图大小上限 25MB */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** 单图下载超时 20s */
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** 防路径逃逸：文件相对路径必须落在模板目录内 */
function resolveInside(baseDir: string, relPath: string): string | null {
  const abs = path.resolve(baseDir, ...relPath.split('/'));
  if (abs !== baseDir && !abs.startsWith(baseDir + path.sep)) return null;
  return abs;
}

async function readTexts(
  baseDir: string,
  files: readonly string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of files) {
    const abs = resolveInside(baseDir, rel);
    if (!abs) continue;
    try {
      out[rel] = await fs.promises.readFile(abs, 'utf-8');
    } catch {
      // 文件读取失败（被占用/消失）跳过该文件
    }
  }
  return out;
}

/** 扫描工作区全部外链图片（去重聚合后的清单，供渲染层选择） */
export async function scanWorkspaceExternalImages(templateName: string): Promise<ExternalImage[]> {
  const baseDir = getTemplateDir(templateName);
  const pages = await scanHtmlPages(templateName);
  const cssFiles = await listCssFiles(templateName);
  const [html, css] = await Promise.all([
    readTexts(baseDir, pages),
    readTexts(baseDir, cssFiles)
  ]);
  return collectExternalImages({ html, css });
}

/**
 * 下载一张图片并做类型/大小校验。
 * 扩展名判定：Content-Type 是图片 → 用之；显式 octet-stream/无类型 → 用 URL 扩展名；
 * Content-Type 明确是文本/HTML/JSON 等非图片资源 → 判失败（通常是错误页/防盗链）。
 */
async function downloadImage(
  url: string
): Promise<{ bytes: Buffer; ext: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await net.fetch(url, {
      signal: controller.signal,
      redirect: 'follow'
    });
  } catch {
    throw new Error('下载失败：网络不可达或超时');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ctExt = contentType ? extFromContentType(contentType) : null;
  const urlExt = imageExtFromUrl(url);

  let ext: string;
  if (ctExt) {
    ext = ctExt;
  } else if (!contentType || contentType === 'application/octet-stream' || contentType === 'binary/octet-stream') {
    if (!urlExt) throw new Error('无法识别图片类型（无扩展名且无 Content-Type）');
    ext = urlExt;
  } else {
    throw new Error(`不是图片资源（Content-Type: ${contentType}）`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('下载内容为空');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`超过单图 25MB 上限`);
  return { bytes, ext };
}

/** 已存在同主干文件时复用（任意扩展名命中即视为已本地化，保证操作幂等） */
async function findExistingAsset(assetsDir: string, base: string): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(assetsDir);
    const hit = entries.find((n) => n.startsWith(`${base}.`));
    return hit ?? null;
  } catch {
    return null;
  }
}

/**
 * 执行外链图片本地化。
 * @param urls 指定下载的 URL 子集（扫描结果中的规范化 URL）；省略/空数组 = 全部
 */
export async function localizeWorkspaceImages(
  templateName: string,
  urls?: readonly string[]
): Promise<LocalizeImageReport> {
  const baseDir = getTemplateDir(templateName);
  const images = await scanWorkspaceExternalImages(templateName);
  const wanted = urls && urls.length > 0 ? new Set(urls) : null;
  const selected = wanted ? images.filter((i) => wanted.has(i.url)) : images;

  const localized: LocalizedImageItem[] = [];
  const failed: FailedImageItem[] = [];
  /** url → 落盘文件名 */
  const filesByName = new Map<string, string>();
  const assetsDir = path.join(baseDir, ...EXTERNAL_IMAGES_DIR.split('/'));

  // 1. 逐张下载（复用既有文件），失败不阻断其余图片
  for (const img of selected) {
    const base = assetFileBase(img.url);
    try {
      let fileName = await findExistingAsset(assetsDir, base);
      if (fileName) {
        filesByName.set(img.url, fileName);
        localized.push({
          url: img.url,
          sitePath: assetSitePath(fileName),
          fileName,
          bytes: 0,
          files: img.locations.map((l) => l.source)
        });
        continue;
      }
      const { bytes, ext } = await downloadImage(img.url);
      fileName = `${base}.${ext}`;
      const abs = resolveInside(baseDir, assetSitePath(fileName));
      if (!abs) throw new Error('目标路径非法');
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, bytes);
      filesByName.set(img.url, fileName);
      localized.push({
        url: img.url,
        sitePath: assetSitePath(fileName),
        fileName,
        bytes: bytes.length,
        files: img.locations.map((l) => l.source)
      });
    } catch (e) {
      failed.push({ url: img.url, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // 2. 在成功下载的图片所出现的文件中改写引用，仅写回有变化的文件
  const changedHtml: string[] = [];
  const changedCss: string[] = [];
  const involvedFiles = new Map<string, 'html' | 'css'>();
  for (const item of localized) {
    const src = images.find((i) => i.url === item.url);
    for (const loc of src?.locations ?? []) involvedFiles.set(loc.source, loc.kind);
  }

  for (const [rel, kind] of involvedFiles) {
    const abs = resolveInside(baseDir, rel);
    if (!abs) continue;
    let text: string;
    try {
      text = await fs.promises.readFile(abs, 'utf-8');
    } catch {
      continue;
    }
    const replacements = [...filesByName.entries()]
      .filter(([url]) => {
        const img = images.find((i) => i.url === url);
        return img?.locations.some((l) => l.source === rel) ?? false;
      })
      .map(([url, fileName]) => ({
        url,
        localRef: relativeAssetRef(rel, assetSitePath(fileName))
      }));
    const next = rewriteExternalRefs(text, replacements);
    if (next === text) continue;
    try {
      await fs.promises.writeFile(abs, next, 'utf-8');
      (kind === 'css' ? changedCss : changedHtml).push(rel);
    } catch (e) {
      // 单文件写失败：把对应图片从成功明细回退为失败，避免报告与磁盘不一致
      const urls = replacements.map((r) => r.url);
      for (const u of urls) {
        const idx = localized.findIndex((x) => x.url === u);
        if (idx >= 0) {
          const [item] = localized.splice(idx, 1);
          filesByName.delete(u);
          failed.push({
            url: u,
            reason: `改写 ${rel} 失败：${e instanceof Error ? e.message : String(e)}`
          });
          void item;
        }
      }
    }
  }

  localized.sort((a, b) => a.url.localeCompare(b.url));
  failed.sort((a, b) => a.url.localeCompare(b.url));
  changedHtml.sort();
  changedCss.sort();
  return { localized, failed, changedHtml, changedCss };
}
