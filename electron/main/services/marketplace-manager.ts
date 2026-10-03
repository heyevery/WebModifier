// electron/main/services/marketplace-manager.ts
// 模板市场：扫描只读的内置市场目录，使用模板时复制一份到用户模板库

import * as fs from 'fs';
import * as path from 'path';
import type { MarketTemplateMeta } from '@shared/types/ipc';
import { getMarketplaceDir } from './app-paths';
import { copyIntoLibrary, countMarkers } from './template-manager';

/** 判断目录是否为含 HTML 的模板（与 listTemplates 口径一致） */
async function hasHtmlFile(dir: string): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && /\.html?$/i.test(entry.name)) return true;
  }
  return false;
}

/** 递归统计模板目录内全部 HTML 的标记数量 */
async function countTemplateMarkers(dir: string): Promise<number> {
  let total = 0;
  async function walk(current: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        try {
          const html = await fs.promises.readFile(full, 'utf-8');
          total += countMarkers(html);
        } catch {
          // 单个文件读取失败不影响整体
        }
      }
    }
  }
  await walk(dir);
  return total;
}

async function countHtmlPages(dir: string): Promise<number> {
  let count = 0;
  async function walk(current: string): Promise<void> {
    const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name));
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        count++;
      }
    }
  }
  await walk(dir);
  return count;
}

/** 列出市场中全部可用模板（按分类、名称排序） */
export async function listMarketplaceTemplates(): Promise<MarketTemplateMeta[]> {
  const root = getMarketplaceDir();
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return []; // 市场目录不存在（如裁剪过的安装包）
  }

  const result: MarketTemplateMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(root, entry.name);
    if (!(await hasHtmlFile(dir))) continue;

    let config: {
      title?: string;
      description?: string;
      category?: string;
      emoji?: string;
      tags?: string[];
    } = {};
    try {
      config = JSON.parse(await fs.promises.readFile(path.join(dir, 'config.wt.json'), 'utf-8'));
    } catch {
      // 无配置也允许展示
    }

    const [pageCount, regionCount] = await Promise.all([
      countHtmlPages(dir),
      countTemplateMarkers(dir)
    ]);

    result.push({
      name: entry.name,
      title: config.title || entry.name,
      description: config.description || '一个开箱即用的网页模板。',
      category: config.category || '其他',
      emoji: config.emoji || '📄',
      tags: Array.isArray(config.tags) ? config.tags.slice(0, 4) : [],
      pageCount,
      regionCount
    });
  }

  result.sort((a, b) => a.category.localeCompare(b.category, 'zh-CN') || a.title.localeCompare(b.title, 'zh-CN'));
  return result;
}

/**
 * 使用市场模板：复制一份到用户模板库（原件保持只读）。
 * newName 可指定期望的副本目录名，重名时自动追加 -1/-2。
 */
export async function useMarketplaceTemplate(name: string, newName?: string): Promise<string> {
  const root = getMarketplaceDir();
  const srcDir = path.join(root, name);
  const stat = await fs.promises.stat(srcDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`市场中不存在模板: ${name}`);
  }
  if (!(await hasHtmlFile(srcDir))) {
    throw new Error(`该模板目录中没有 HTML 文件: ${name}`);
  }
  return copyIntoLibrary(srcDir, newName?.trim() || name);
}
