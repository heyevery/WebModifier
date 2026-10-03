// electron/main/services/app-paths.ts
// 打包后路径解析：
// - 模板（用户内容，需可写且跨版本保留）→ userData/templates
// - 导出默认目录 → 文档/Web Modifier 导出
// dev 模式沿用项目目录，保持开发体验不变

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export function getTemplatesDir(): string {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'templates')
    : path.join(process.cwd(), 'templates');
}

/**
 * 项目草稿目录：保存工作区编辑进度（仅存差异值，不改动 templates/ 下的模板）
 * 开发态取项目根 projects/，打包后放 userData/projects
 */
export function getProjectsDir(): string {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'projects')
    : path.join(process.cwd(), 'projects');
}

/**
 * 模板市场内置模板目录（只读）：
 * 开发态取项目根 marketplace/，打包后随安装包放在 resources/marketplace
 */
export function getMarketplaceDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'marketplace')
    : path.join(process.cwd(), 'marketplace');
}

export function getExportsDir(): string {
  return app.isPackaged
    ? path.join(app.getPath('documents'), 'Web Modifier 导出')
    : path.join(process.cwd(), 'exports');
}

/**
 * 「在外部浏览器预览」的临时导出目录：按工作区名分子目录，每次预览整体覆盖。
 * 与正式导出分开，避免污染用户的「Web Modifier 导出」。
 */
export function getPreviewsDir(): string {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'previews')
    : path.join(process.cwd(), 'previews');
}

/**
 * 首次运行：把随安装包携带的示例模板从 resources/ 拷到 userData/templates
 * 只拷 userData 里不存在的目录（用户已导入/改过的内容永不覆盖）
 */
export function migrateBundledTemplates(): void {
  if (!app.isPackaged) return;
  const bundledDir = path.join(process.resourcesPath, 'templates');
  const targetDir = getTemplatesDir();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(bundledDir, { withFileTypes: true });
  } catch {
    return; // 安装包未带模板
  }

  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dest = path.join(targetDir, entry.name);
    if (fs.existsSync(dest)) continue; // 用户内容优先
    fs.cpSync(path.join(bundledDir, entry.name), dest, { recursive: true });
    console.log('[migrate] bundled template ->', dest);
  }
}
