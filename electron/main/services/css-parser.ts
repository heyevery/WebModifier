// electron/main/services/css-parser.ts
// CSS 文件服务：列出模板内 CSS 文件、读取解析（只读）。
// CSS 可视化编辑不写模板本体：差异随项目/自动草稿保存，导出时再覆盖到导出副本。
// 纯解析逻辑在 @shared/css-utils（renderer 实时预览也复用）

import * as fs from 'fs';
import * as path from 'path';
import { parseCss, type CssBlock } from '@shared/css-utils';
import { getTemplateDir } from './template-manager';

// 跳过的目录（与 template-manager 保持一致）
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', '.cache']);

/** 递归扫描模板内所有 .css 文件，返回相对模板根的 POSIX 路径 */
export async function listCssFiles(templateName: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), relPath);
      } else if (e.isFile() && /\.css$/i.test(e.name)) {
        files.push(relPath);
      }
    }
  }
  await walk(getTemplateDir(templateName), '');
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

// 防路径逃逸：解析后的绝对路径必须仍在模板目录内，且必须是 .css 文件
function resolveInside(templateName: string, relPath: string): string {
  const base = path.resolve(getTemplateDir(templateName));
  const abs = path.resolve(base, relPath);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error('非法的 CSS 文件路径');
  }
  if (!/\.css$/i.test(abs)) {
    throw new Error('仅支持编辑 .css 文件');
  }
  return abs;
}

/** 读取 CSS 文件并解析为结构化块 */
export async function readCssFile(
  templateName: string,
  relPath: string
): Promise<{ path: string; blocks: CssBlock[]; cssText: string }> {
  const abs = resolveInside(templateName, relPath);
  const cssText = await fs.promises.readFile(abs, 'utf-8');
  return { path: relPath, blocks: parseCss(cssText), cssText };
}
