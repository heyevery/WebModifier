// electron/main/ipc/template.ts
// IPC 处理器：列表 / 解析 / 导出 / 选目录

import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '@shared/types/ipc';
import type { ExportTemplateArgs, CheckExportArgs, CheckHealthArgs, PickImageArgs, ListFilesArgs, ListCssFilesArgs, ReadCssFileArgs, UseMarketTemplateArgs, ImportPageArgs, CreateWorkspaceArgs, SaveProjectArgs, DeleteProjectArgs, ManagePageArgs, SetPageOrderArgs, PageMetaArgs, WritePageMetaArgs, ApplySiteHeadArgs, ManageTemplateArgs, SaveAutosaveArgs, GetAutosaveArgs, DeleteAutosaveArgs, SetDirtyArgs, ShellOpenArgs, ScanExternalImagesArgs, LocalizeImagesArgs } from '@shared/types/ipc';
import { listMarketplaceTemplates, useMarketplaceTemplate } from '../services/marketplace-manager';
import { exportTemplate, injectSiteCode } from '../services/exporter';
import { scanPageHealth, missingAssetIssue, type PendingAsset, type HealthIssue } from '@shared/health-check';
import { listCssFiles, readCssFile } from '../services/css-parser';
import {
  listTemplates,
  getTemplateDir,
  importTemplateToLibrary,
  copyImageToTemplate,
  parseWorkspace,
  listTemplateFiles,
  restoreTemplateSnapshot,
  importTemplateAsPage,
  createWorkspaceTemplate,
  renamePage,
  duplicatePage,
  deletePage,
  setPageOrderConfig,
  renameWorkspace,
  duplicateWorkspace,
  deleteWorkspace
} from '../services/template-manager';
import { readPageMeta, writePageMeta, applySiteHeadToAll } from '../services/page-meta';
import { scanWorkspaceExternalImages, localizeWorkspaceImages } from '../services/image-localize';
import {
  listProjects,
  readProject,
  saveProject,
  deleteProject,
  getAutosave,
  readAutosaveFile,
  saveAutosave,
  deleteAutosave,
  retargetProjects,
  deleteProjectsForTemplate
} from '../services/project-manager';
import { clearDisplayHtml } from '../protocol/template-protocol';
import { applySectionStructure } from '@shared/section-structure';
import {
  clearStructure,
  migratePageStructure,
  renameSession
} from '../services/section-session';
import { registerSectionIpc } from './sections';
import { getExportsDir, getPreviewsDir } from '../services/app-paths';
import { zipDirectory } from '../services/zipper';

const EXPORTS_DIR = getExportsDir();

// 未保存状态：由渲染层通过 SET_DIRTY 上报
let isContentDirty = false;
// 关窗拦截流程中，渲染层完成落盘后置 true，放行真正退出
let allowQuit = false;

export function getContentDirty(): boolean {
  return isContentDirty;
}
export function takeAllowQuit(): boolean {
  const v = allowQuit;
  allowQuit = false;
  return v;
}

export function registerIpc(): void {
  ipcMain.handle(IPC.LIST_TEMPLATES, async () => {
    return { templates: await listTemplates() };
  });

  // 列出模板目录的文件树（资源管理器用）
  ipcMain.handle(IPC.LIST_FILES, async (_, args: ListFilesArgs) => {
    const tree = await listTemplateFiles(args.templateName);
    return { tree };
  });

  // 默认导出目录（打包后为 文档/Web Modifier 导出，前端预览用）
  ipcMain.handle(IPC.GET_EXPORT_DIR, () => ({ dir: EXPORTS_DIR }));

  // 外部浏览器预览的临时导出目录
  ipcMain.handle(IPC.GET_PREVIEW_DIR, () => ({ dir: getPreviewsDir() }));

  // 系统外壳打开：.html 走默认浏览器、目录走资源管理器；reveal 在资源管理器中定位选中
  ipcMain.handle(IPC.SHELL_OPEN, async (_, args: ShellOpenArgs) => {
    const target = path.resolve(String(args?.target ?? ''));
    try {
      await fs.promises.access(target);
    } catch {
      return { ok: false, error: '目标不存在' };
    }
    if (args.reveal) {
      shell.showItemInFolder(target);
      return { ok: true };
    }
    const err = await shell.openPath(target);
    return err ? { ok: false, error: err } : { ok: true };
  });

  // 解析整个工作区：扫描全部 HTML 页面，返回 pages + 带归属页的 regions
  ipcMain.handle(IPC.PARSE_TEMPLATE, async (_, args: { templateName: string }) => {
    // 导入后模板文件可能更新过，先清旧缓存再重新解析；
    // 结构会话同样清空（打开草稿时由渲染层随后 SET_STRUCTURE 恢复）
    clearDisplayHtml(args.templateName);
    clearStructure(args.templateName);
    return await buildParseResult(args.templateName);
  });

  // 恢复模板：用首次打开时保存的原件快照整体回滚（连已删除的组件也能还原）
  ipcMain.handle(IPC.RESET_TEMPLATE, async (_, args: { templateName: string }) => {
    const { templateName } = args;
    const ok = await restoreTemplateSnapshot(templateName);
    if (ok) {
      clearDisplayHtml(templateName); // 内容已变，清缓存强制重解析
      clearStructure(templateName); // 结构变换一并丢弃
    }
    return { ok };
  });

  // 从工作区选择一个模板，整体复制为当前模板的新页面（独立子目录）
  ipcMain.handle(IPC.IMPORT_PAGE, async (_, args: ImportPageArgs) => {
    const result = await importTemplateAsPage(args.templateName, args.sourceTemplate, args.pageName);
    // 新页面磁盘已落盘，清掉旧 displayHtml 缓存，随后渲染端重新解析
    clearDisplayHtml(args.templateName);
    return result;
  });

  // 新建空白工作区（起始页 + 样式 + 快照），返回实际模板名
  ipcMain.handle(IPC.CREATE_WORKSPACE, async (_, args: CreateWorkspaceArgs) => {
    const name = (args.name || '').trim();
    if (!name) throw new Error('工作区名称不能为空');
    return await createWorkspaceTemplate(name);
  });

  // 项目草稿：列表 / 读取 / 保存（新建或更新）/ 删除
  ipcMain.handle(IPC.LIST_PROJECTS, async () => {
    return { projects: await listProjects() };
  });

  ipcMain.handle(IPC.SAVE_PROJECT, async (_, args: SaveProjectArgs) => {
    return await saveProject(args);
  });

  ipcMain.handle(IPC.READ_PROJECT, async (_, id: string) => {
    const p = await readProject(id);
    return {
      id: p.id,
      name: p.name,
      templateName: p.templateName,
      edits: p.edits,
      cssEdits: p.cssEdits,
      injections: p.injections
    };
  });

  ipcMain.handle(IPC.DELETE_PROJECT, async (_, args: DeleteProjectArgs) => {
    const ok = await deleteProject(args.id);
    return { ok };
  });

  ipcMain.handle(IPC.EXPORT_TEMPLATE, async (_, args: ExportTemplateArgs) => {
    try {
      const { templateName, regions, exportName, targetDir, zip } = args;
      const templateDir = getTemplateDir(templateName);

      // 导出目录 = <目标根目录>/<自定义名称>/
      const safeName = sanitizeExportName(exportName);
      if (!safeName) throw new Error('导出名称无效');
      const exportDir = path.join(targetDir || EXPORTS_DIR, safeName);
      await fs.promises.mkdir(exportDir, { recursive: true });

      // 1. 先全量拷贝工作区（含所有页面与资产；无标记页面原样保留）
      await copyAssets(templateDir, exportDir);

      // 1.5 覆盖会话内改动的 CSS（CSS 差异只存在草稿/会话中，模板磁盘是干净基线）
      if (args.cssEdits) {
        const exportRoot = path.resolve(exportDir);
        for (const [cssRel, cssText] of Object.entries(args.cssEdits)) {
          if (!/\.css$/i.test(cssRel)) continue;
          const cssOut = path.resolve(exportDir, cssRel);
          // 防路径逃逸：只允许写导出目录内的 .css
          if (!cssOut.startsWith(exportRoot + path.sep)) continue;
          await fs.promises.mkdir(path.dirname(cssOut), { recursive: true });
          await overwriteFile(cssOut, cssText);
          console.log('[export] css ->', cssOut);
        }
      }

      // 2. 对含标记页面逐页替换后覆盖写入（后写，避免被旧版覆盖）
      // 含结构变换但已无 region 的页面（删光区块）也要处理，故并集 structureByPage 键
      const structurePages = Object.keys(args.structureByPage ?? {});
      const pages = [...new Set([...regions.map((r) => r.page), ...structurePages])];
      let firstOutput = '';
      for (const page of pages) {
        let srcHtml = await fs.promises.readFile(path.join(templateDir, page), 'utf-8');
        // 区块结构（复制/删除/排序）先作用于干净基线，再写入会话值
        srcHtml = applySectionStructure(srcHtml, args.structureByPage?.[page]);
        const pageRegions = regions.filter((r) => r.page === page);
        // pageRegions 为空（区块被删光）也要走导出：负责剥离残留标记
        const finalHtml = exportTemplate(srcHtml, pageRegions);
        const outputPath = path.join(exportDir, page);
        await overwriteFile(outputPath, finalHtml);
        if (!firstOutput) firstOutput = outputPath;
        console.log('[export] page ->', outputPath);
      }

      // 2.5 全站自定义代码注入到导出副本的每一个 HTML 页面（含无标记页面；模板本体不动）
      if (args.injections && ((args.injections.head ?? '').trim() || (args.injections.body ?? '').trim())) {
        const exportRoot = path.resolve(exportDir);
        const htmlFiles: string[] = [];
        const collectHtml = async (dir: string): Promise<void> => {
          let entries: fs.Dirent[];
          try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue;
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) {
              await collectHtml(abs);
            } else if (e.isFile() && /\.html?$/i.test(e.name)) {
              const resolved = path.resolve(abs);
              if (resolved.startsWith(exportRoot + path.sep)) htmlFiles.push(abs);
            }
          }
        };
        await collectHtml(exportDir);
        for (const htmlPath of htmlFiles) {
          const html = await fs.promises.readFile(htmlPath, 'utf-8');
          await overwriteFile(htmlPath, injectSiteCode(html, args.injections));
        }
        console.log('[export] injected site code into', htmlFiles.length, 'html page(s)');
      }

      const outputPath = firstOutput || path.join(exportDir, 'index.html');
      console.log('[export] success ->', exportDir);

      // 3. 自动打包为 ZIP
      let zipPath: string | undefined;
      if (zip) {
        zipPath = path.join(targetDir || EXPORTS_DIR, `${safeName}.zip`);
        await zipDirectory(exportDir, zipPath);
        console.log('[export] zip ->', zipPath);
      }

      return { outputPath, zipPath };
    } catch (err) {
      console.error('[export] failed:', err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  });

  // 检查导出目录是否已存在同名文件夹（用于模态框实时提示）
  ipcMain.handle(IPC.CHECK_EXPORT, async (_, args: CheckExportArgs) => {
    const safeName = sanitizeExportName(args.exportName);
    if (!safeName) return { exists: false };
    const dir = path.join(args.targetDir || EXPORTS_DIR, safeName);
    const exists = await fs.promises
      .access(dir)
      .then(() => true)
      .catch(() => false);
    return { exists };
  });

  // 导出前健康检查：枚举全部 HTML → 应用会话编辑重建最终 HTML → 扫描死链/缺图/空元信息
  ipcMain.handle(IPC.CHECK_EXPORT_HEALTH, async (_, args: CheckHealthArgs) => {
    const templateDir = path.resolve(getTemplateDir(args.templateName));

    // 递归收集 HTML 页面（POSIX 相对路径，与 region.page 语义一致）
    const pages: string[] = [];
    const collectPages = async (dir: string, rel: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          await collectPages(path.join(dir, e.name), childRel);
        } else if (e.isFile() && /\.html?$/i.test(e.name)) {
          pages.push(childRel.split(path.sep).join('/'));
        }
      }
    };
    await collectPages(templateDir, '');

    const issues: HealthIssue[] = [];
    const pendingAssets: PendingAsset[] = [];
    for (const page of pages) {
      // 与导出完全相同的重建路径：磁盘 HTML（含已持久化的页面 head 设置）+ 结构变换 + 会话 regions
      const baseHtml = await fs.promises.readFile(path.join(templateDir, ...page.split('/')), 'utf-8');
      const srcHtml = applySectionStructure(baseHtml, args.structureByPage?.[page]);
      const pageRegions = args.regions.filter((r) => r.page === page);
      const finalHtml = exportTemplate(srcHtml, pageRegions);
      const result = scanPageHealth(page, finalHtml, pages);
      issues.push(...result.issues);
      pendingAssets.push(...result.assets);
    }

    // 批量校验资源是否存在（同一路径只查一次，防逃逸模板目录）
    const existence = new Map<string, boolean>();
    for (const asset of pendingAssets) {
      if (existence.has(asset.resolved)) continue;
      const abs = path.resolve(templateDir, ...asset.resolved.split('/'));
      const inside = abs === templateDir || abs.startsWith(templateDir + path.sep);
      if (!inside) {
        existence.set(asset.resolved, false);
        continue;
      }
      existence.set(
        asset.resolved,
        await fs.promises
          .access(abs)
          .then(() => true)
          .catch(() => false)
      );
    }
    for (const asset of pendingAssets) {
      const issue = missingAssetIssue(asset, existence.get(asset.resolved) ?? false);
      if (issue) issues.push(issue);
    }

    // 错误在前、警告在后；同页相邻，便于报告分组展示
    issues.sort((a, b) =>
      a.severity === b.severity
        ? a.page === b.page
          ? a.message.localeCompare(b.message)
          : a.page.localeCompare(b.page)
        : a.severity === 'error'
          ? -1
          : 1
    );

    return { pagesScanned: pages.length, issues };
  });

  ipcMain.handle(IPC.PICK_DIRECTORY, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { dir: null };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择导出目录'
    });
    return { dir: result.canceled ? null : result.filePaths[0] };
  });

  ipcMain.handle(IPC.IMPORT_TEMPLATE, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) throw new Error('未找到应用窗口');
    const result = await dialog.showOpenDialog(win, {
      title: '选择要导入的 HTML 文件或模板文件夹',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: '网页文件', extensions: ['html', 'htm'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return await importTemplateToLibrary(result.filePaths[0]);
  });

  // 选择本地图片 → 拷入模板 assets/ → 返回相对路径
  ipcMain.handle(IPC.PICK_IMAGE, async (_, args: PickImageArgs) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) throw new Error('未找到应用窗口');
    const result = await dialog.showOpenDialog(win, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const relativePath = await copyImageToTemplate(
      args.templateName,
      result.filePaths[0],
      args.page
    );
    return { relativePath };
  });

  // CSS 可视化编辑：列出 / 读取（CSS 编辑只存会话与草稿，不提供写模板入口）
  ipcMain.handle(IPC.LIST_CSS_FILES, async (_, args: ListCssFilesArgs) => {
    const files = await listCssFiles(args.templateName);
    return { files };
  });

  ipcMain.handle(IPC.READ_CSS_FILE, async (_, args: ReadCssFileArgs) => {
    const res = await readCssFile(args.templateName, args.path);
    return res;
  });

  // 模板市场：列出只读内置模板
  ipcMain.handle(IPC.LIST_MARKET_TEMPLATES, async () => {
    const templates = await listMarketplaceTemplates();
    return { templates };
  });

  // 模板市场：使用模板 = 复制一份到用户模板库（重名自动去重）
  ipcMain.handle(IPC.USE_MARKET_TEMPLATE, async (_, args: UseMarketTemplateArgs) => {
    const name = await useMarketplaceTemplate(args.name, args.newName);
    return { name };
  });

  // ---------- 页面管理：重命名 / 复制 / 删除 ----------
  ipcMain.handle(IPC.MANAGE_PAGE, async (_, args: ManagePageArgs) => {
    const { templateName, action, page, newName } = args;
    let pagePath: string | undefined;
    if (action === 'rename') {
      pagePath = await renamePage(templateName, page, (newName || '').trim());
      migratePageStructure(templateName, page, pagePath);
    } else if (action === 'duplicate') {
      pagePath = await duplicatePage(templateName, page);
      // 新页面是磁盘独立副本，默认结构；原页结构保留，无需迁移
    } else if (action === 'delete') {
      await deletePage(templateName, page);
      migratePageStructure(templateName, page); // 丢弃被删页面的结构
    } else {
      throw new Error('未知的页面操作');
    }
    clearDisplayHtml(templateName);
    return { ok: true, pagePath };
  });

  // 页面排序：写入 config.pageOrder
  ipcMain.handle(IPC.SET_PAGE_ORDER, async (_, args: SetPageOrderArgs) => {
    await setPageOrderConfig(args.templateName, args.order);
    return { ok: true };
  });

  // 页面设置：读取
  ipcMain.handle(IPC.READ_PAGE_META, async (_, args: PageMetaArgs) => {
    const meta = await readPageMeta(args.templateName, args.page);
    return { meta };
  });

  // 页面设置：写入磁盘 → 清缓存 → 重新解析（渲染端拿到最新 pages/regions/meta）
  ipcMain.handle(IPC.WRITE_PAGE_META, async (_, args: WritePageMetaArgs) => {
    await writePageMeta(args.templateName, args.page, args.meta);
    clearDisplayHtml(args.templateName);
    return await buildParseResult(args.templateName);
  });

  // 全站 head 批量默认：逐页写盘 → 清缓存 → 重新解析
  ipcMain.handle(IPC.APPLY_SITE_HEAD, async (_, args: ApplySiteHeadArgs) => {
    const { pagesScanned, changedPages } = await applySiteHeadToAll(args.templateName, {
      favicon: args.favicon,
      titleMode: args.titleMode,
      titleText: args.titleText,
      description: args.description,
      ogEnabled: args.ogEnabled,
      ogTitle: args.ogTitle,
      ogDescription: args.ogDescription,
      ogImage: args.ogImage
    });
    clearDisplayHtml(args.templateName);
    const parsed = await buildParseResult(args.templateName);
    return { ...parsed, pagesScanned, changedPages };
  });

  // 外链图片本地化：扫描清单
  ipcMain.handle(IPC.SCAN_EXTERNAL_IMAGES, async (_evt, args: ScanExternalImagesArgs) => {
    const images = await scanWorkspaceExternalImages(args.templateName);
    return { images };
  });

  // 外链图片本地化：下载到 assets/external 并改写磁盘引用 → 清缓存 → 重解析
  ipcMain.handle(IPC.LOCALIZE_IMAGES, async (_evt, args: LocalizeImagesArgs) => {
    const report = await localizeWorkspaceImages(args.templateName, args.urls);
    // 有任意 HTML/CSS 被改写时，协议缓存必须失效后再重解析
    if (report.changedHtml.length > 0 || report.changedCss.length > 0) {
      clearDisplayHtml(args.templateName);
    }
    const parsed = await buildParseResult(args.templateName);
    return { ...report, ...parsed };
  });

  // ---------- 工作区管理：重命名 / 复制副本 / 删除 ----------
  ipcMain.handle(IPC.MANAGE_TEMPLATE, async (_, args: ManageTemplateArgs) => {
    const { templateName, action, newName } = args;
    if (action === 'rename') {
      const name = await renameWorkspace(templateName, (newName || '').trim());
      await retargetProjects(templateName, name);
      // 目录改名后旧缓存全部失效，按新名重建；会话结构一并迁移
      renameSession(templateName, name);
      clearDisplayHtml(templateName);
      return { ok: true, name };
    }
    if (action === 'duplicate') {
      const name = await duplicateWorkspace(templateName, newName);
      return { ok: true, name };
    }
    if (action === 'delete') {
      try {
        // 先彻底删除模板目录；确认磁盘已无残留后再清理关联草稿，
        // 避免删除失败却把草稿标记成「源模板已删除」
        await deleteWorkspace(templateName);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      const removedProjects = await deleteProjectsForTemplate(templateName);
      clearDisplayHtml(templateName);
      clearStructure(templateName);
      return { ok: true, removedProjects };
    }
    throw new Error('未知的工作区操作');
  });

  // ---------- 自动保存草稿 ----------
  ipcMain.handle(IPC.SAVE_AUTOSAVE, async (_, args: SaveAutosaveArgs) => {
    return await saveAutosave(
      args.templateName,
      args.edits,
      args.cssEdits,
      args.injections,
      args.structureByPage,
      args.sharedEdits
    );
  });

  ipcMain.handle(IPC.GET_AUTOSAVE, async (_, args: GetAutosaveArgs) => {
    const meta = await getAutosave(args.templateName);
    const file = await readAutosaveFile(args.templateName);
    const hasStructure = !!file?.structureByPage && Object.keys(file.structureByPage).length > 0;
    const hasShared = !!file?.sharedEdits && Object.keys(file.sharedEdits).length > 0;
    if (
      !meta ||
      (!hasStructure &&
        !hasShared &&
        meta.editCount === 0 &&
        meta.cssCount === 0 &&
        meta.injectionCount === 0)
    ) {
      return { autosave: null };
    }
    return {
      autosave: {
        ...meta,
        edits: file?.edits ?? {},
        cssEdits: file?.cssEdits,
        injections: file?.injections,
        structureByPage: file?.structureByPage,
        sharedEdits: file?.sharedEdits
      }
    };
  });

  ipcMain.handle(IPC.DELETE_AUTOSAVE, async (_, args: DeleteAutosaveArgs) => {
    await deleteAutosave(args.templateName);
    return { ok: true };
  });

  // 渲染层上报脏状态，主进程据此在关窗时弹确认
  ipcMain.handle(IPC.SET_DIRTY, async (_, _args: SetDirtyArgs) => {
    isContentDirty = !!_args.dirty;
  });

  // 渲染层完成「保存后退出」的落盘后调用
  ipcMain.handle(IPC.CONFIRM_QUIT, async () => {
    allowQuit = true;
    BrowserWindow.getAllWindows().forEach((w) => w.close());
  });

  // 区块结构操作（复制/上移/下移/删除）；复用本文件的重解析
  registerSectionIpc((templateName) => buildParseResult(templateName));
}

/** 解析工作区并附带各页面 <head> 元信息（PARSE / 写页面设置后共用） */
export async function buildParseResult(templateName: string) {
  const { pages, regions, config } = await parseWorkspace(templateName);
  const metaByPage: Record<string, Awaited<ReturnType<typeof readPageMeta>>> = {};
  for (const page of pages) {
    try {
      metaByPage[page] = await readPageMeta(templateName, page);
    } catch {
      metaByPage[page] = { title: '', description: '', favicon: '', lang: '' };
    }
  }
  return { templateName, pages, regions, config, metaByPage };
}

// 导出名称安全过滤：去掉非法字符与路径分隔符，防路径注入
function sanitizeExportName(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\./g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// 覆盖写入：先解除只读属性并删除旧文件，带短暂重试（应对杀软扫描占用）
async function overwriteFile(filePath: string, content: string): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
      // 最后一次尝试前，清除只读属性并删除旧文件
      if (attempt === 1) {
        try {
          await fs.promises.chmod(filePath, 0o666);
          await fs.promises.rm(filePath, { force: true });
        } catch {
          // 旧文件可能不存在，忽略
        }
      }
      if (!retryable || attempt === 2) throw e;
      await sleep(150 * (attempt + 1));
    }
  }
}

// 全量拷贝工作区（所有页面 + 资产；仅排除 config.wt.json）
// 含标记页面随后由 exportTemplate 覆盖写入
async function copyAssets(srcDir: string, destDir: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // 跳过隐藏项（.wt-original 快照 / .wt-origin 标记等内部文件）
    if (entry.name.startsWith('.')) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await fs.promises.mkdir(destPath, { recursive: true });
      await copyAssets(srcPath, destPath);
    } else if (entry.isFile() && entry.name !== 'config.wt.json') {
      try {
        // 目标已存在时先删除，避免只读/占用导致 copyFile 失败
        await fs.promises.rm(destPath, { force: true });
        await fs.promises.copyFile(srcPath, destPath);
      } catch (e) {
        console.error('[export] asset copy failed:', destPath, e);
      }
    }
  }
}
