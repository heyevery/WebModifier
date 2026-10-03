// electron/main/services/template-manager.ts
// 工作区（模板）列表 / 读取 / 导入：多文件网站支持

import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import type { Region, TemplateMeta, TemplateSource, WTConfig } from '@shared/types/region';
import type { FileTreeNode } from '@shared/types/ipc';
import { rewritePageHrefs } from '@shared/template-url';
import { parseTemplate } from './marker-parser';
import { setDisplayHtml } from '../protocol/template-protocol';
import { applySectionStructure } from '@shared/section-structure';
import { unifySharedValues } from '@shared/shared-regions';
import { getPageStructure } from './section-session';
import { getTemplatesDir } from './app-paths';
import { rmRobust, rmFileRobust } from './fs-utils';

const TEMPLATES_DIR = getTemplatesDir();

// 文件夹模式下跳过的目录
const COPY_SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', '.cache']);

// 模板来源标记文件 / 原件快照目录（均以 . 开头，所有扫描器自动跳过）
const ORIGIN_FILE = '.wt-origin';
const SNAPSHOT_DIR = '.wt-original';

export interface ImportResult {
  name: string;
  regionCount: number;
  mode: 'file' | 'folder';
}

// 文件名中不允许的字符 → -
function sanitizeName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned || 'template';
}

// 目标目录已存在时追加 -1 / -2；exclude 中的名字视为不冲突（重命名自身时用）
async function resolveUniqueDir(baseName: string, exclude: string[] = []): Promise<string> {
  const skip = new Set(exclude);
  let name = baseName;
  let i = 1;
  while (true) {
    if (skip.has(name)) return name;
    const dir = path.join(TEMPLATES_DIR, name);
    const exists = await fs.promises
      .access(dir)
      .then(() => true)
      .catch(() => false);
    if (!exists) return name;
    name = `${baseName}-${i++}`;
  }
}

// 统计 HTML 中可编辑标记数量（块级注释 + 属性标记，含全站公共区 @wt:shared）
export function countMarkers(html: string): number {
  const blockCount = (html.match(/<!--\s*@wt:(?:edit|shared)\b/g) || []).length;
  const attrCount = (html.match(/\sdata-wt-(?:edit|shared)="[^"]+"/g) || []).length;
  return blockCount + attrCount;
}

// 递归拷贝目录（跳过部分黑名单目录）
async function copyDirRecursive(srcDir: string, destDir: string): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true });
  const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    // 跳过隐藏项（.wt-original 快照 / .wt-origin 标记等）与黑名单目录
    if (entry.name.startsWith('.') || (entry.isDirectory() && COPY_SKIP_DIRS.has(entry.name))) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

// 单文件模式：解析 HTML 中相对路径的资产并一并拷贝
async function copyReferencedAssets(
  html: string,
  htmlSourceDir: string,
  destDir: string
): Promise<void> {
  const $ = cheerio.load(html);
  const refs = new Set<string>();
  $('[src]').each((_, el) => {
    const v = $(el).attr('src');
    if (v) refs.add(v);
  });
  $('[href]').each((_, el) => {
    const v = $(el).attr('href');
    if (v) refs.add(v);
  });
  $('[poster]').each((_, el) => {
    const v = $(el).attr('poster');
    if (v) refs.add(v);
  });

  for (const ref of refs) {
    // 跳过远程 / data URI / 锚点 / 协议相对 URL
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('#') || ref.startsWith('mailto:')) {
      continue;
    }
    const cleanRef = ref.split('#')[0].split('?')[0];
    if (!cleanRef) continue;
    const srcPath = path.resolve(htmlSourceDir, cleanRef);
    const destPath = path.join(destDir, cleanRef);
    // 防路径逃逸 & 文件必须真实存在
    if (!srcPath.startsWith(path.resolve(htmlSourceDir) + path.sep)) continue;
    try {
      await fs.promises.access(srcPath);
    } catch {
      continue;
    }
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.copyFile(srcPath, destPath);
  }
}

/**
 * 导入用户选择的 HTML 文件或模板文件夹到 templates/
 */
export async function importTemplateToLibrary(srcPath: string): Promise<ImportResult> {
  const stat = await fs.promises.stat(srcPath);

  await fs.promises.mkdir(TEMPLATES_DIR, { recursive: true });

  let mode: 'file' | 'folder';
  let htmlSourcePath: string;
  let sourceRoot: string;
  let baseName: string;

  if (stat.isDirectory()) {
    mode = 'folder';
    // 根目录优先 index.html，否则向下找一层
    const rootIndex = path.join(srcPath, 'index.html');
    const hasRootIndex = await fs.promises
      .access(rootIndex)
      .then(() => true)
      .catch(() => false);
    if (hasRootIndex) {
      htmlSourcePath = rootIndex;
      sourceRoot = srcPath;
      baseName = path.basename(srcPath);
    } else {
      const entries = await fs.promises.readdir(srcPath, { withFileTypes: true });
      const sub = entries.find(
        (e) => e.isFile() && /\.html?$/i.test(e.name)
      );
      if (!sub) {
        throw new Error('所选文件夹中没有找到 HTML 文件');
      }
      htmlSourcePath = path.join(srcPath, sub.name);
      sourceRoot = srcPath;
      baseName = path.basename(srcPath);
    }
  } else {
    mode = 'file';
    if (!/\.html?$/i.test(srcPath)) {
      throw new Error('请选择 .html 文件或模板文件夹');
    }
    htmlSourcePath = srcPath;
    sourceRoot = path.dirname(srcPath);
    baseName = path.basename(srcPath, path.extname(srcPath));
  }

  const name = await resolveUniqueDir(sanitizeName(baseName));
  const destDir = getTemplateDir(name);

  if (mode === 'folder') {
    await copyDirRecursive(sourceRoot, destDir);
    // 非 index.html 命名时统一规范为 index.html
    if (path.basename(htmlSourcePath).toLowerCase() !== 'index.html') {
      await fs.promises.copyFile(htmlSourcePath, path.join(destDir, 'index.html'));
    }
  } else {
    await fs.promises.mkdir(destDir, { recursive: true });
    const html = await fs.promises.readFile(htmlSourcePath, 'utf-8');
    await fs.promises.writeFile(path.join(destDir, 'index.html'), html, 'utf-8');
    await copyReferencedAssets(html, sourceRoot, destDir);
  }

  // 标记来源并保存原件快照
  await writeTemplateOrigin(name, 'import');
  await saveTemplateSnapshot(name);

  // 统计全部页面的标记总数（多页网站支持）
  const pages = await scanHtmlPages(name);
  let total = 0;
  for (const page of pages) {
    const html = await fs.promises.readFile(path.join(destDir, page), 'utf-8');
    total += countMarkers(html);
  }
  return { name, regionCount: total, mode };
}

export function getTemplateDir(name: string): string {
  return path.join(TEMPLATES_DIR, name);
}

// ---------- 模板来源标记 & 原件快照 ----------

/** 写入模板来源标记（.wt-origin，内容为 market/import） */
export async function writeTemplateOrigin(name: string, source: TemplateSource): Promise<void> {
  await fs.promises.writeFile(path.join(getTemplateDir(name), ORIGIN_FILE), source, 'utf-8');
}

/** 读取模板来源，无标记（老模板）返回 custom */
export async function readTemplateOrigin(name: string): Promise<TemplateSource> {
  try {
    const raw = (await fs.promises.readFile(path.join(getTemplateDir(name), ORIGIN_FILE), 'utf-8')).trim();
    if (raw === 'market' || raw === 'import') return raw;
  } catch { /* ignore */ }
  return 'custom';
}

/** 是否存在原件快照 */
export async function hasTemplateSnapshot(name: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(path.join(getTemplateDir(name), SNAPSHOT_DIR));
    return entries.length > 0;
  } catch {
    return false;
  }
}

/** 把模板当前内容保存为原件快照（.wt-original/），已存在则跳过 */
export async function saveTemplateSnapshot(name: string): Promise<void> {
  const dir = getTemplateDir(name);
  if (await hasTemplateSnapshot(name)) return;
  const snapshotDir = path.join(dir, SNAPSHOT_DIR);
  await fs.promises.mkdir(snapshotDir, { recursive: true });
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // 跳过 .wt-origin / .wt-original 自身
    const src = path.join(dir, entry.name);
    const dest = path.join(snapshotDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(src, dest);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(src, dest);
    }
  }
}

/**
 * 恢复模板：用 .wt-original/ 快照覆盖当前内容
 * 步骤：删除模板根下所有非 . 开头项 → 从快照拷回 → 返回是否成功
 */
export async function restoreTemplateSnapshot(name: string): Promise<boolean> {
  const dir = getTemplateDir(name);
  const snapshotDir = path.join(dir, SNAPSHOT_DIR);
  if (!(await hasTemplateSnapshot(name))) return false;

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // 保留 .wt-origin / .wt-original
    await rmRobust(path.join(dir, entry.name));
  }
  await copyDirRecursive(snapshotDir, dir);
  return true;
}

/**
 * 把外部目录（模板市场 / 导入源）整体复制为用户模板库中的新模板。
 * 目标名自动去重（-1、-2…），返回实际目录名。
 */
export async function copyIntoLibrary(srcDir: string, preferredName: string): Promise<string> {
  await fs.promises.mkdir(TEMPLATES_DIR, { recursive: true });
  const name = await resolveUniqueDir(sanitizeName(preferredName));
  const destDir = getTemplateDir(name);
  await copyDirRecursive(srcDir, destDir);
  await writeTemplateOrigin(name, 'market');
  await saveTemplateSnapshot(name);
  return name;
}

/**
 * 新建空白工作区：index.html（含少量可编辑标记的起始页）+ style.css + config.wt.json
 * 目录名自动去重；写入来源标记与原件快照（支持「恢复模板」）。
 */
export async function createWorkspaceTemplate(displayName: string): Promise<{ name: string; regionCount: number }> {
  await fs.promises.mkdir(TEMPLATES_DIR, { recursive: true });
  const name = await resolveUniqueDir(sanitizeName(displayName));
  const dir = getTemplateDir(name);
  await fs.promises.mkdir(dir, { recursive: true });

  const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${displayName}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="page">
    <!-- @wt:edit name="hero-title" type="text" label="主标题" -->
    <h1 class="hero-title">${displayName}</h1>
    <!-- /@wt:edit -->

    <!-- @wt:edit name="hero-text" type="text" label="副标题" -->
    <p class="hero-text">双击文字即可开始编辑，也可以在右侧面板修改内容。</p>
    <!-- /@wt:edit -->

    <!-- @wt:edit name="hero-link" type="link" label="链接" -->
    <a class="hero-link" href="index.html">开始使用</a>
    <!-- /@wt:edit -->
  </main>
</body>
</html>
`;

  const styleCss = `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", sans-serif;
  color: #1f2937;
  background: #f9fafb;
  line-height: 1.6;
}

.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 48px 24px;
  text-align: center;
}

.hero-title {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.hero-text {
  font-size: 16px;
  color: #6b7280;
  max-width: 520px;
}

.hero-link {
  margin-top: 8px;
  display: inline-block;
  padding: 10px 24px;
  border-radius: 8px;
  background: #4f46e5;
  color: #ffffff;
  text-decoration: none;
  font-size: 14px;
  transition: background 0.2s;
}

.hero-link:hover {
  background: #4338ca;
}
`;

  const config: WTConfig = {
    name: displayName,
    version: '1.0.0'
  };

  await fs.promises.writeFile(path.join(dir, 'index.html'), indexHtml, 'utf-8');
  await fs.promises.writeFile(path.join(dir, 'style.css'), styleCss, 'utf-8');
  await fs.promises.writeFile(path.join(dir, 'config.wt.json'), JSON.stringify(config, null, 2), 'utf-8');

  await writeTemplateOrigin(name, 'custom');
  await saveTemplateSnapshot(name);

  return { name, regionCount: countMarkers(indexHtml) };
}

/** 在目录第一层查找第一个 HTML 文件（无 index.html 时的兜底） */
async function findFirstHtmlFile(dir: string): Promise<string | null> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isFile() && /\.html?$/i.test(e.name)) return path.join(dir, e.name);
  }
  return null;
}

export interface ImportPageResult {
  /** 新页面入口，相对目标模板根的 POSIX 路径（如 about/index.html） */
  pagePath: string;
  /** 实际落盘的子目录名（可能因重名自动去重） */
  dirName: string;
  /** 入口页识别到的可编辑标记数量 */
  regionCount: number;
}

/**
 * 把工作区中的另一个模板整体复制为「当前模板」的一个新页面。
 * 每个导入页面独占一个子目录，源模板的 style.css / assets / 子页面以相对路径
 * 原样工作；不同页面间即使 region id 重名也由 regionsByPage 按页隔离。
 * 不会复制 .wt-original / .wt-origin（copyDirRecursive 跳过隐藏项）与 config.wt.json（工作区元数据）。
 */
export async function importTemplateAsPage(
  targetTemplate: string,
  sourceTemplate: string,
  preferredDir?: string
): Promise<ImportPageResult> {
  if (!sourceTemplate || sourceTemplate === targetTemplate) {
    throw new Error('不能把当前模板自身导入为页面');
  }
  const templatesRoot = path.resolve(TEMPLATES_DIR);
  const targetRoot = getTemplateDir(targetTemplate);
  const sourceRoot = path.resolve(getTemplateDir(sourceTemplate));
  // 防路径逃逸：源目录必须位于工作区内
  if (!sourceRoot.startsWith(templatesRoot + path.sep)) {
    throw new Error('非法的源模板路径');
  }
  const srcStat = await fs.promises.stat(sourceRoot).catch(() => null);
  if (!srcStat || !srcStat.isDirectory()) throw new Error('源模板不存在');

  await fs.promises.mkdir(targetRoot, { recursive: true });

  // 页面目录名：允许用户自定义；中文保留，非法字符/空白由 sanitizeName 处理
  const baseName = sanitizeName(preferredDir && preferredDir.trim() ? preferredDir : sourceTemplate);
  let dirName = baseName;
  let i = 1;
  while (true) {
    const exists = await fs.promises
      .access(path.join(targetRoot, dirName))
      .then(() => true)
      .catch(() => false);
    if (!exists) break;
    dirName = `${baseName}-${i++}`;
  }

  const destDir = path.join(targetRoot, dirName);
  await copyDirRecursive(sourceRoot, destDir);
  // config.wt.json 是工作区模板级元数据，不属于页面资源
  await rmFileRobust(path.join(destDir, 'config.wt.json'));

  // 入口统一为 <dir>/index.html；源模板根没有 index.html 时用第一个 HTML 兜底
  const entry = path.join(destDir, 'index.html');
  const hasEntry = await fs.promises
    .access(entry)
    .then(() => true)
    .catch(() => false);
  if (!hasEntry) {
    const firstHtml = await findFirstHtmlFile(destDir);
    if (!firstHtml) {
      await rmRobust(destDir);
      throw new Error('源模板中没有找到 HTML 文件');
    }
    await fs.promises.copyFile(firstHtml, entry);
  }

  const html = await fs.promises.readFile(entry, 'utf-8');
  return { pagePath: `${dirName}/index.html`, dirName, regionCount: countMarkers(html) };
}

/**
 * 递归扫描模板内所有 HTML 页面，返回相对根的 POSIX 路径（index.html 排最前）
 */
export async function scanHtmlPages(templateName: string): Promise<string[]> {
  const pages: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || COPY_SKIP_DIRS.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), relPath);
      } else if (e.isFile() && /\.html?$/i.test(e.name) && e.name !== 'config.wt.json') {
        pages.push(relPath);
      }
    }
  }
  await walk(getTemplateDir(templateName), '');
  // index.html 优先，其余按路径排序
  pages.sort((a, b) => {
    if (a === 'index.html') return -1;
    if (b === 'index.html') return 1;
    return a.localeCompare(b);
  });
  return pages;
}

/**
 * 按 config.pageOrder 排序页面：index.html 永远第一；
 * 其后按自定义顺序，未列入 order 的新增页面按路径字母序追加。
 */
export function orderPages(pages: string[], order?: string[]): string[] {
  const sorted = [...pages].sort((a, b) => {
    if (a === 'index.html') return -1;
    if (b === 'index.html') return 1;
    return a.localeCompare(b);
  });
  if (!order || order.length === 0) return sorted;
  const rest = sorted.filter((p) => p !== 'index.html');
  const known = new Set(rest);
  const ordered = order.filter((p) => known.has(p));
  const orderedSet = new Set(ordered);
  const extras = rest.filter((p) => !orderedSet.has(p));
  return ['index.html', ...ordered, ...extras].filter((p) => pages.includes(p));
}

/**
 * 解析整个工作区：扫描所有 HTML 页面，逐页解析标记并缓存 displayHtml
 * 每个 region 带上所属 page（相对根 POSIX 路径）
 */
export async function parseWorkspace(templateName: string): Promise<{
  pages: string[];
  regions: Region[];
  config: WTConfig | null;
}> {
  // 老模板（创建时还没有快照机制）在首次解析时自动补一份原件快照，
  // 使「恢复模板」对所有模板可用（快照 = 首次打开时的状态）
  await saveTemplateSnapshot(templateName);

  const config = await readTemplateConfig(templateName);
  const scanned = await scanHtmlPages(templateName);
  const pages = orderPages(scanned, config?.pageOrder);
  const regions: Region[] = [];

  for (const page of pages) {
    let html: string;
    try {
      html = await fs.promises.readFile(path.join(getTemplateDir(templateName), page), 'utf-8');
    } catch {
      continue;
    }
    // 会话区块结构（复制/删除/排序）先作用于干净基线，再照常解析
    html = applySectionStructure(html, getPageStructure(templateName, page));
    const parsed = parseTemplate(html, config, page);
    regions.push(...parsed.regions);
    // 每页的 displayHtml 缓存到协议层（iframe 按页面路径加载）
    setDisplayHtml(templateName, page, parsed.displayHtml);
  }

  // 全站公共区：以页面顺序首次出现的值为权威，统一所有页同名标记
  // （iframe 加载后渲染层的 replayCurrentEdits 会把权威值回放到各页显示文档）
  return { pages, regions: unifySharedValues(pages, regions), config };
}

/**
 * 把用户选择的图片拷贝到「当前页面同级」的 assets/ 下
 * 返回相对该页面目录的路径，写入 src 后与浏览器相对路径解析语义一致
 */
export async function copyImageToTemplate(
  templateName: string,
  srcPath: string,
  page: string
): Promise<string> {
  // 页面所在目录（相对模板根），如 "sub/about.html" → "sub"
  const pageDir = path.posix.dirname(page.replace(/\\/g, '/'));
  const assetsDir = path.join(getTemplateDir(templateName), pageDir, 'assets');
  await fs.promises.mkdir(assetsDir, { recursive: true });
  const fileName = path.basename(srcPath);
  await fs.promises.copyFile(srcPath, path.join(assetsDir, fileName));
  return `assets/${fileName}`;
}

export async function listTemplates(): Promise<TemplateMeta[]> {
  try {
    const entries = await fs.promises.readdir(TEMPLATES_DIR, { withFileTypes: true });
    const templates: TemplateMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const templatePath = path.join(TEMPLATES_DIR, entry.name);
      const configPath = path.join(templatePath, 'config.wt.json');
      const pages = await scanHtmlPages(entry.name);
      if (pages.length === 0) continue; // 无 HTML 的工作区跳过
      const hasConfig = await fs.promises
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      const source = await readTemplateOrigin(entry.name);
      const hasSnapshot = await hasTemplateSnapshot(entry.name);
      templates.push({ name: entry.name, path: templatePath, hasConfig, pageCount: pages.length, source, hasSnapshot });
    }
    return templates;
  } catch {
    return [];
  }
}

export async function readTemplateConfig(name: string): Promise<WTConfig | null> {
  const configPath = path.join(getTemplateDir(name), 'config.wt.json');
  try {
    const content = await fs.promises.readFile(configPath, 'utf-8');
    return JSON.parse(content) as WTConfig;
  } catch {
    return null;
  }
}

/**
 * 递归扫描模板目录，返回文件树结构（用于资源管理器展示）
 */
export async function listTemplateFiles(templateName: string): Promise<FileTreeNode[]> {
  const dir = getTemplateDir(templateName);
  async function walk(currentDir: string, rel: string): Promise<FileTreeNode[]> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: FileTreeNode[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || COPY_SKIP_DIRS.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const children = await walk(path.join(currentDir, e.name), relPath);
        nodes.push({ name: e.name, path: relPath, isDirectory: true, children });
      } else {
        nodes.push({ name: e.name, path: relPath, isDirectory: false });
      }
    }
    // 文件夹在前，文件在后，各自按名称排序
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }
  return walk(dir, '');
}

// =================== 页面管理（重命名 / 复制 / 删除） ===================

/** 在指定父目录下找不冲突的名字：base 已存在时追加 -1/-2 */
async function resolveUniqueName(parentDir: string, base: string, suffix = ''): Promise<string> {
  let name = `${base}${suffix}`;
  let i = 1;
  while (true) {
    const exists = await fs.promises
      .access(path.join(parentDir, name))
      .then(() => true)
      .catch(() => false);
    if (!exists) return name;
    name = `${base}-${i++}${suffix}`;
  }
}

/**
 * 遍历工作区全部 HTML 页面，把指向 oldTarget 的站内链接重写到 newTarget。
 * 必须在目录/文件移动「之前」或「之后」传入当时有效的页面路径集合；
 * 这里每次实时扫描磁盘，调用方负责选择调用时机。
 */
async function rewriteLinksAcrossPages(
  templateName: string,
  oldTarget: string,
  newTarget: string,
  extraKnown: string[] = []
): Promise<void> {
  const root = getTemplateDir(templateName);
  // 重命名发生在移动之后：旧路径已不在磁盘扫描结果里，需作为虚拟已知页补入，
  // 否则显式指向旧路径的 href 无法被 resolveKnownPage 命中
  const pages = [...(await scanHtmlPages(templateName)), ...extraKnown];
  for (const page of pages) {
    const filePath = path.join(root, page);
    const html = await fs.promises.readFile(filePath, 'utf-8').catch(() => null);
    if (html === null) continue;
    const next = rewritePageHrefs(html, page, oldTarget, newTarget, pages);
    if (next !== html) await fs.promises.writeFile(filePath, next, 'utf-8');
  }
}

/** 页面路径是否为「子目录入口」形式（dir/index.html） */
function pageDirOf(page: string): { dir: string; isRoot: boolean; isIndex: boolean } {
  const normalized = page.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const dir = slash >= 0 ? normalized.slice(0, slash) : '';
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return { dir, isRoot: dir === '', isIndex: base.toLowerCase() === 'index.html' };
}

/**
 * 重命名页面：
 * - 子目录页面（about/index.html）→ 重命名整个子目录（页面资源随目录一起移动）
 * - 根目录普通页面（page.html）→ 重命名文件本身
 * - 根 index.html（主页）不允许重命名
 * 移动后重写全站指向旧路径的链接。
 */
export async function renamePage(
  templateName: string,
  page: string,
  preferredName: string
): Promise<string> {
  const base = sanitizeName(preferredName);
  if (!base) throw new Error('页面名称无效');
  const info = pageDirOf(page);
  if (info.isRoot && info.isIndex) throw new Error('主页 index.html 不能重命名');

  // 未实际改名（用户直接确认原名字）→ 原样返回，避免被去重逻辑加成 -1
  const currentStem = info.isRoot
    ? path.basename(page, path.extname(page) || '.html')
    : info.dir.slice(info.dir.lastIndexOf('/') + 1);
  if (currentStem === base) return page;

  const root = getTemplateDir(templateName);
  const absOld = path.join(root, page);
  await fs.promises.access(absOld);

  let newPage: string;
  if (info.isRoot) {
    // 根目录普通文件：<stem>.html
    const ext = path.extname(page) || '.html';
    const newFile = await resolveUniqueName(root, base, ext);
    await fs.promises.rename(absOld, path.join(root, newFile));
    newPage = newFile;
  } else {
    // dir 可能是多级（a/b），仅最后一段改名；父目录一定已存在
    const parent = info.dir.includes('/') ? info.dir.slice(0, info.dir.lastIndexOf('/')) : '';
    const parentAbs = path.join(root, parent);
    const newDirName = await resolveUniqueName(parentAbs, base);
    await fs.promises.rename(path.join(root, info.dir), path.join(parentAbs, newDirName));
    newPage = parent ? `${parent}/${newDirName}/index.html` : `${newDirName}/index.html`;
  }

  await rewriteLinksAcrossPages(templateName, page, newPage, [page]);
  // 同步自定义排序中的旧路径，否则重命名页会被视为未排序新页
  const config = await readTemplateConfig(templateName);
  if (config?.pageOrder?.includes(page)) {
    await updateTemplateConfig(templateName, {
      pageOrder: config.pageOrder.map((p) => (p === page ? newPage : p))
    });
  }
  return newPage;
}

/**
 * 复制页面：子目录整体复制（含资源），根目录普通页面复制为新文件；
 * 新页面目录深度与原页面一致，页面内相对链接无需改写。
 */
export async function duplicatePage(templateName: string, page: string): Promise<string> {
  const info = pageDirOf(page);
  if (info.isRoot && info.isIndex) {
    // 复制主页 = 在根目录生成 index-copy.html 入口页
    const root = getTemplateDir(templateName);
    const newFile = await resolveUniqueName(root, 'index-copy', '.html');
    await fs.promises.copyFile(path.join(root, page), path.join(root, newFile));
    return newFile;
  }
  const root = getTemplateDir(templateName);
  if (info.isRoot) {
    const ext = path.extname(page) || '.html';
    const stem = path.basename(page, ext);
    const newFile = await resolveUniqueName(root, `${stem}-copy`, ext);
    await fs.promises.copyFile(path.join(root, page), path.join(root, newFile));
    return newFile;
  }
  const parentRel = info.dir.includes('/') ? info.dir.slice(0, info.dir.lastIndexOf('/')) : '';
  const lastSeg = info.dir.slice(info.dir.lastIndexOf('/') + 1);
  const parentAbs = path.join(root, parentRel);
  const newDirName = await resolveUniqueName(parentAbs, `${lastSeg}-copy`);
  await copyDirRecursive(path.join(root, info.dir), path.join(parentAbs, newDirName));
  return parentRel ? `${parentRel}/${newDirName}/index.html` : `${newDirName}/index.html`;
}

/** 删除页面（主页不允许）；删除前把全站指向它的链接改回主页 index.html */
export async function deletePage(templateName: string, page: string): Promise<void> {
  const info = pageDirOf(page);
  if (info.isRoot && info.isIndex) throw new Error('主页 index.html 不能删除');
  const root = getTemplateDir(templateName);
  const abs = path.join(root, page);
  await fs.promises.access(abs);
  // 先改链接再删目录（扫描时被删页面还在，但其自身即将被删除，改写无害）
  if (page !== 'index.html') {
    await rewriteLinksAcrossPages(templateName, page, 'index.html');
  }
  await rmRobust(abs);
  // 清理自定义排序中的残留路径
  const config = await readTemplateConfig(templateName);
  if (config?.pageOrder?.includes(page)) {
    await updateTemplateConfig(templateName, {
      pageOrder: config.pageOrder.filter((p) => p !== page)
    });
  }
}

/** 持久化自定义页面顺序到 config.wt.json */
export async function setPageOrderConfig(templateName: string, order: string[]): Promise<void> {
  await updateTemplateConfig(templateName, { pageOrder: order });
}

/** 合并写入 config.wt.json（不存在则创建） */
export async function updateTemplateConfig(
  templateName: string,
  patch: Partial<WTConfig>
): Promise<WTConfig> {
  const existing = (await readTemplateConfig(templateName)) ?? {
    name: templateName,
    version: '1.0.0'
  };
  const next: WTConfig = { ...existing, ...patch };
  await fs.promises.writeFile(
    path.join(getTemplateDir(templateName), 'config.wt.json'),
    JSON.stringify(next, null, 2),
    'utf-8'
  );
  return next;
}

// =================== 工作区管理（重命名 / 复制副本 / 删除） ===================

/** 重命名工作区目录；调用方负责同步项目草稿的 templateName 与 displayHtml 缓存 */
export async function renameWorkspace(oldName: string, preferredName: string): Promise<string> {
  const base = sanitizeName(preferredName);
  if (!base) throw new Error('工作区名称无效');
  const oldDir = getTemplateDir(oldName);
  await fs.promises.access(oldDir);
  const newName = await resolveUniqueDir(base, [oldName]);
  if (newName === oldName) return oldName;
  await fs.promises.rename(oldDir, getTemplateDir(newName));
  return newName;
}

/** 复制整个工作区为新的自定义工作区（不含快照等隐藏文件，复制后建立自己的快照） */
export async function duplicateWorkspace(
  templateName: string,
  preferredName?: string
): Promise<string> {
  const srcDir = getTemplateDir(templateName);
  await fs.promises.access(srcDir);
  const base = sanitizeName(preferredName?.trim() ? preferredName! : `${templateName}-copy`);
  const newName = await resolveUniqueDir(base);
  const destDir = getTemplateDir(newName);
  await copyDirRecursive(srcDir, destDir);
  await writeTemplateOrigin(newName, 'custom');
  await saveTemplateSnapshot(newName);
  return newName;
}

/**
 * 删除整个工作区目录（关联项目草稿由 project-manager 另行清理）。
 * Windows 下经重试+只读兜底处理；若最终仍有残留会抛错，调用方不得当作成功。
 */
export async function deleteWorkspace(templateName: string): Promise<void> {
  await rmRobust(getTemplateDir(templateName));
}
