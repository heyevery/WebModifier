// shared/types/ipc.ts
// IPC 通道名 + 参数/返回类型契约
import type { ParseResult, PageMeta, Region, TemplateMeta } from './region';
import type { CssBlock } from '../css-utils';
import type { HealthIssue } from '../health-check';
import type { SiteTitleMode } from '../site-head';
import type { StructureByPage, SectionStructure } from '../section-structure';
import type { SharedEdits } from '../shared-regions';
import type { ExternalImage, LocalizeImageReport } from '../external-images';

export const IPC = {
  LIST_TEMPLATES: 'wt:list-templates',
  LIST_FILES: 'wt:list-files',
  PARSE_TEMPLATE: 'wt:parse-template',
  EXPORT_TEMPLATE: 'wt:export-template',
  PICK_DIRECTORY: 'wt:pick-directory',
  IMPORT_TEMPLATE: 'wt:import-template',
  CHECK_EXPORT: 'wt:check-export',
  CHECK_EXPORT_HEALTH: 'wt:check-export-health',
  PICK_IMAGE: 'wt:pick-image',
  GET_EXPORT_DIR: 'wt:get-export-dir',
  LIST_CSS_FILES: 'wt:list-css-files',
  READ_CSS_FILE: 'wt:read-css-file',
  LIST_MARKET_TEMPLATES: 'wt:list-market-templates',
  USE_MARKET_TEMPLATE: 'wt:use-market-template',
  RESET_TEMPLATE: 'wt:reset-template',
  IMPORT_PAGE: 'wt:import-page',
  CREATE_WORKSPACE: 'wt:create-workspace',
  LIST_PROJECTS: 'wt:list-projects',
  SAVE_PROJECT: 'wt:save-project',
  READ_PROJECT: 'wt:read-project',
  DELETE_PROJECT: 'wt:delete-project',
  // 页面管理：重命名 / 复制 / 删除（自动修正站内链接）
  MANAGE_PAGE: 'wt:manage-page',
  // 页面排序（上移/下移，持久化到 config.pageOrder）
  SET_PAGE_ORDER: 'wt:set-page-order',
  // 页面设置：<title> / description / favicon / lang
  READ_PAGE_META: 'wt:read-page-meta',
  WRITE_PAGE_META: 'wt:write-page-meta',
  // 全站 head 批量默认：favicon / 标题模式 / 统一 description / Open Graph
  APPLY_SITE_HEAD: 'wt:apply-site-head',
  // 工作区管理：重命名 / 复制副本 / 删除
  MANAGE_TEMPLATE: 'wt:manage-template',
  // 自动保存草稿（按模板一份，不出现在「我的项目」列表）
  SAVE_AUTOSAVE: 'wt:save-autosave',
  GET_AUTOSAVE: 'wt:get-autosave',
  DELETE_AUTOSAVE: 'wt:delete-autosave',
  // 窗口关闭前的未保存修改拦截
  SET_DIRTY: 'wt:set-dirty',
  CONFIRM_QUIT: 'wt:confirm-quit',
  // 用系统默认程序打开路径（导出目录 / 浏览器打开 HTML / 资源管理器定位 ZIP）
  SHELL_OPEN: 'wt:shell-open',
  // 外部浏览器预览用的临时导出目录（每次预览覆盖同一工作区的副本）
  GET_PREVIEW_DIR: 'wt:get-preview-dir',
  // 应用自动更新（electron-updater，GitHub Releases；仅打包安装版支持）
  CHECK_FOR_UPDATES: 'wt:check-for-updates',
  DOWNLOAD_UPDATE: 'wt:download-update',
  QUIT_INSTALL_UPDATE: 'wt:quit-install-update',
  // 区块结构操作（复制 / 上移 / 下移 / 删除）
  SECTION_OP: 'wt:section-op',
  // 整表恢复会话结构（打开项目草稿后）
  SET_STRUCTURE: 'wt:set-structure',
  // 外链图片本地化：扫描清单 / 下载并改写引用
  SCAN_EXTERNAL_IMAGES: 'wt:scan-external-images',
  LOCALIZE_IMAGES: 'wt:localize-images'
} as const;

/** 主进程推送给渲染层的更新状态事件名（webContents.send） */
export const UPDATE_STATUS_EVENT = 'wt:update-status';

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface ListTemplatesArgs {}

export interface ListTemplatesResult {
  templates: TemplateMeta[];
}

// 文件树节点
export interface FileTreeNode {
  name: string;
  path: string; // 相对模板根的 POSIX 路径
  isDirectory: boolean;
  children?: FileTreeNode[];
}

export interface ListFilesArgs {
  templateName: string;
}

export interface ListFilesResult {
  tree: FileTreeNode[];
}

export interface ParseTemplateArgs {
  templateName: string;
}

export interface ParseTemplateResult extends ParseResult {}

export interface ExportTemplateArgs {
  templateName: string;
  regions: Region[];
  exportName: string; // 导出子文件夹名（会做安全过滤）
  targetDir?: string; // 导出根目录，默认项目 exports/
  zip?: boolean; // 是否自动打包为 ZIP
  cssEdits?: CssEdits; // 会话内改动的 CSS 文件全文，覆盖写入导出副本（模板本体不动）
  injections?: SiteInjections; // 全站自定义代码，注入导出副本的每个页面（模板本体不动）
  structureByPage?: StructureByPage; // 区块结构（复制/删除/排序），导出前应用到基线 HTML
}

/** 全站自定义代码：原样注入每个 HTML 页面（统计、客服浮窗、站长验证等） */
export interface SiteInjections {
  head?: string; // 注入 </head> 前
  body?: string; // 注入 </body> 前
}

export interface ExportTemplateResult {
  outputPath: string;
  zipPath?: string; // 生成的 ZIP 路径（若启用打包）
}

export interface CheckExportArgs {
  exportName: string;
  targetDir?: string;
}

export interface CheckExportResult {
  exists: boolean;
}

/** 导出前健康检查：在与导出一致的最终 HTML 上扫描（复用会话 regions 重建） */
export interface CheckHealthArgs {
  templateName: string;
  regions: Region[];
  structureByPage?: StructureByPage;
}

export interface CheckHealthResult {
  pagesScanned: number;
  issues: HealthIssue[];
}

export interface PickImageArgs {
  templateName: string;
  page: string; // 当前页面路径（图片放该页同级 assets/，相对路径语义一致）
}

export interface PickImageResult {
  canceled?: boolean;
  // 相对当前页面所在目录的路径（如 assets/hero.png），直接写入 src 语义正确
  relativePath: string;
}

export interface PickDirectoryResult {
  dir: string | null;
}

export interface ImportTemplateResult {
  canceled?: boolean;
  name: string;
  regionCount: number; // 识别到的可编辑区段数量
  mode: 'file' | 'folder';
}

export interface GetExportDirResult {
  dir: string; // 主进程解析的默认导出根目录（打包后为 文档/Web Modifier 导出）
}

// ---- CSS 可视化编辑 ----

export interface ListCssFilesArgs {
  templateName: string;
}

export interface ListCssFilesResult {
  files: string[]; // 相对模板根的 POSIX 路径
}

export interface ReadCssFileArgs {
  templateName: string;
  path: string; // 相对模板根的 CSS 文件路径
}

export interface ReadCssFileResult {
  path: string;
  blocks: CssBlock[]; // 结构化块（注释 / at 规则 / 普通规则）
  cssText: string; // 原始文本（参考用）
}

// ---- 模板市场 ----

export interface MarketTemplateMeta {
  name: string; // 市场目录名（唯一标识）
  title: string; // 展示名
  description: string;
  category: string;
  emoji: string;
  tags: string[];
  pageCount: number;
  regionCount: number;
}

export interface ListMarketTemplatesResult {
  templates: MarketTemplateMeta[];
}

export interface UseMarketTemplateArgs {
  name: string; // 市场模板目录名
  newName?: string; // 期望的副本名（可选，默认沿用市场模板名）
}

export interface UseMarketTemplateResult {
  name: string; // 复制后用户模板库中的实际目录名（可能自动去重）
}

// ---- 模板恢复（原件快照回滚） ----

export interface ResetTemplateArgs {
  templateName: string;
}

export interface ResetTemplateResult {
  ok: boolean; // false = 该模板没有可用快照
}

// ---- 从工作区模板导入为新页面 ----

export interface ImportPageArgs {
  templateName: string; // 目标模板（当前打开的模板）
  sourceTemplate: string; // 工作区中的源模板名
  pageName?: string; // 期望的页面目录名（可自定义，支持中文；重名自动去重）
}

export interface ImportPageResult {
  pagePath: string; // 新页面入口相对路径（如 about/index.html）
  dirName: string; // 实际落盘的子目录名
  regionCount: number; // 入口页可编辑标记数
}

// ---- 新建工作区 ----

export interface CreateWorkspaceArgs {
  name: string; // 工作区显示名（支持中文；落盘目录名自动清洗+去重）
}

export interface CreateWorkspaceResult {
  name: string; // 实际创建的模板目录名
  regionCount: number; // 起始页可编辑标记数
}

// ---- 项目草稿（保存工作区进度，不改模板） ----

/** 页面 POSIX 路径 → (region id → 当前值)；仅保存相对基线有改动的项 */
export type ProjectEdits = Record<string, Record<string, string>>;

/**
 * CSS 文件相对模板根的 POSIX 路径 → 该文件完整（规范化）CSS 文本。
 * 仅保存相对模板基线有改动的 CSS 文件；CSS 编辑不写模板本体，随草稿隔离。
 */
export type CssEdits = Record<string, string>;

export interface ProjectMeta {
  id: string;
  name: string; // 草稿显示名
  templateName: string; // 源模板目录名
  editCount: number;
  cssCount?: number; // 草稿中改动的 CSS 文件数
  createdAt: number;
  updatedAt: number;
  templateExists: boolean; // 源模板是否还在
}

export interface ListProjectsResult {
  projects: ProjectMeta[];
}

export interface SaveProjectArgs {
  id?: string; // 缺省 = 新建；存在 = 更新同名草稿
  name: string;
  templateName: string;
  edits: ProjectEdits;
  cssEdits?: CssEdits; // 相对模板基线改动的 CSS 文件全文
  injections?: SiteInjections; // 全站自定义代码（head/body）
  structureByPage?: StructureByPage; // 区块结构（复制/删除/排序）
  sharedEdits?: SharedEdits; // 全站公共区值（id → 全站唯一值）
}

export interface ReadProjectResult {
  id: string;
  name: string;
  templateName: string;
  edits: ProjectEdits;
  cssEdits?: CssEdits;
  injections?: SiteInjections;
  structureByPage?: StructureByPage;
  sharedEdits?: SharedEdits;
}

export interface DeleteProjectArgs {
  id: string;
}

// ---- 页面管理（重命名 / 复制 / 删除） ----

export interface ManagePageArgs {
  templateName: string;
  action: 'rename' | 'duplicate' | 'delete';
  page: string; // 页面 POSIX 路径
  newName?: string; // rename 时的新目录名
}

export interface ManagePageResult {
  ok: boolean;
  // rename/duplicate 后的新页面路径；delete 时为空
  pagePath?: string;
}

export interface SetPageOrderArgs {
  templateName: string;
  order: string[]; // 完整页面顺序（index.html 仍会被强制排首位）
}

export interface PageMetaArgs {
  templateName: string;
  page: string;
}

export interface ReadPageMetaResult {
  meta: PageMeta;
}

export interface WritePageMetaArgs {
  templateName: string;
  page: string;
  meta: PageMeta;
}

/**
 * 全站 head 批量默认。所有字段除 templateName 外均可选；
 * 未提供（undefined）= 该项不改动，空字符串 = 清除（favicon/description）。
 * favicon/ogImage 约定为站点根相对路径，主进程按各页深度换算页面相对路径。
 */
export interface ApplySiteHeadArgs {
  templateName: string;
  favicon?: string;
  titleMode?: SiteTitleMode;
  titleText?: string;
  description?: string;
  ogEnabled?: boolean;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
}

export interface ApplySiteHeadResult extends ParseTemplateResult {
  pagesScanned: number;
  changedPages: number;
}

// ---- 区块结构操作（仅块级标记区段） ----

export type SectionAction = 'duplicate' | 'move-up' | 'move-down' | 'delete';

export interface SectionOpArgs {
  templateName: string;
  page: string;
  action: SectionAction;
  /** 目标实例 id（复制=源实例；移动/删除=目标实例） */
  id: string;
}

export interface SectionOpResult extends ParseTemplateResult {
  /** duplicate 时新实例包含的全部新 region id → 其源 id（含外层区块与内层 attr 标记），
   *  供渲染层把源区段当前值播种到克隆实例 */
  cloned?: { id: string; sourceId: string }[];
  /** 操作后该页的规范结构；null 表示已回到模板默认（会话中该页键被清除） */
  structure: SectionStructure | null;
}

export interface SetStructureArgs {
  templateName: string;
  structureByPage: StructureByPage;
}

// ---- 外链图片本地化（#10④）----

export interface ScanExternalImagesArgs {
  templateName: string;
}

export interface ScanExternalImagesResult {
  images: ExternalImage[];
}

export interface LocalizeImagesArgs {
  templateName: string;
  /** 选中的规范化外链 URL；省略/空数组 = 本地化扫描到的全部图片 */
  urls?: string[];
}

/** 下载/改写报告 + 改写后的整工作区重解析结果（渲染层据此合并会话） */
export interface LocalizeImagesResult extends LocalizeImageReport, ParseTemplateResult {}

// ---- 工作区管理（重命名 / 复制副本 / 删除） ----

export interface ManageTemplateArgs {
  templateName: string;
  action: 'rename' | 'duplicate' | 'delete';
  newName?: string;
}

export interface ManageTemplateResult {
  ok: boolean;
  name?: string; // rename/duplicate 后的实际目录名（可能自动去重）
  // 删除工作区时一并删除的关联项目草稿数量
  removedProjects?: number;
  // ok=false 时的失败原因（如文件被占用导致目录残留）
  error?: string;
}

// ---- 自动保存草稿 ----

export interface AutosaveMeta {
  templateName: string;
  updatedAt: number;
  editCount: number;
  cssCount?: number; // 改动的 CSS 文件数
  injectionCount?: number; // 自定义代码槽位数（head/body，0–2）
}

export interface SaveAutosaveArgs {
  templateName: string;
  edits: ProjectEdits;
  cssEdits?: CssEdits;
  injections?: SiteInjections;
  structureByPage?: StructureByPage;
  sharedEdits?: SharedEdits;
}

export interface GetAutosaveArgs {
  templateName: string;
}

export interface GetAutosaveResult {
  autosave:
    | (AutosaveMeta & {
        edits: ProjectEdits;
        cssEdits?: CssEdits;
        injections?: SiteInjections;
        structureByPage?: StructureByPage;
        sharedEdits?: SharedEdits;
      })
    | null;
}

export interface DeleteAutosaveArgs {
  templateName: string;
}

export interface SetDirtyArgs {
  dirty: boolean;
}

/** 系统外壳打开：open=默认程序（浏览器/资源管理器），reveal=资源管理器中定位并选中 */
export interface ShellOpenArgs {
  target: string;
  reveal?: boolean;
}

export interface ShellOpenResult {
  ok: boolean;
  error?: string;
}

export interface GetPreviewDirResult {
  dir: string;
}

// ---- 应用自动更新 ----

export type UpdatePhase =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

/** 主→渲染：更新状态推送（下载进度/新版本/错误等） */
export interface UpdateState {
  phase: UpdatePhase;
  /** 新版本号（available/downloading/downloaded） */
  version?: string;
  currentVersion?: string;
  /** 下载进度 0–100 */
  percent?: number;
  /** error 阶段的错误信息 */
  message?: string;
}

export interface CheckUpdatesResult {
  /** false = dev 运行或 portable 便携版，内置更新不适用 */
  supported: boolean;
  available: boolean;
  version?: string;
  currentVersion: string;
}

// preload 暴露的 API 形状
export interface WebModifierApi {
  listTemplates(): Promise<ListTemplatesResult>;
  listFiles(args: ListFilesArgs): Promise<ListFilesResult>;
  parseTemplate(templateName: string): Promise<ParseTemplateResult>;
  exportTemplate(args: ExportTemplateArgs): Promise<ExportTemplateResult>;
  pickDirectory(): Promise<PickDirectoryResult>;
  importTemplate(): Promise<ImportTemplateResult>;
  checkExport(args: CheckExportArgs): Promise<CheckExportResult>;
  checkExportHealth(args: CheckHealthArgs): Promise<CheckHealthResult>;
  pickImage(args: PickImageArgs): Promise<PickImageResult>;
  getExportDir(): Promise<GetExportDirResult>;
  listCssFiles(args: ListCssFilesArgs): Promise<ListCssFilesResult>;
  readCssFile(args: ReadCssFileArgs): Promise<ReadCssFileResult>;
  listMarketTemplates(): Promise<ListMarketTemplatesResult>;
  useMarketTemplate(args: UseMarketTemplateArgs): Promise<UseMarketTemplateResult>;
  resetTemplate(args: ResetTemplateArgs): Promise<ResetTemplateResult>;
  importPage(args: ImportPageArgs): Promise<ImportPageResult>;
  createWorkspace(args: CreateWorkspaceArgs): Promise<CreateWorkspaceResult>;
  listProjects(): Promise<ListProjectsResult>;
  saveProject(args: SaveProjectArgs): Promise<ProjectMeta>;
  readProject(id: string): Promise<ReadProjectResult>;
  deleteProject(args: DeleteProjectArgs): Promise<{ ok: boolean }>;
  managePage(args: ManagePageArgs): Promise<ManagePageResult>;
  setPageOrder(args: SetPageOrderArgs): Promise<{ ok: boolean }>;
  readPageMeta(args: PageMetaArgs): Promise<ReadPageMetaResult>;
  writePageMeta(args: WritePageMetaArgs): Promise<ParseTemplateResult>;
  applySiteHead(args: ApplySiteHeadArgs): Promise<ApplySiteHeadResult>;
  manageTemplate(args: ManageTemplateArgs): Promise<ManageTemplateResult>;
  saveAutosave(args: SaveAutosaveArgs): Promise<AutosaveMeta>;
  getAutosave(args: GetAutosaveArgs): Promise<GetAutosaveResult>;
  deleteAutosave(args: DeleteAutosaveArgs): Promise<{ ok: boolean }>;
  setDirty(args: SetDirtyArgs): Promise<void>;
  confirmQuit(): Promise<void>;
  /** 用系统默认程序打开文件/目录（.html → 默认浏览器，目录 → 资源管理器） */
  openPath(args: ShellOpenArgs): Promise<ShellOpenResult>;
  /** 外部浏览器预览的临时导出根目录 */
  getPreviewDir(): Promise<GetPreviewDirResult>;
  /** 手动检查更新（自动检查在主进程启动后静默进行，结果走 onUpdateStatus） */
  checkForUpdates(): Promise<CheckUpdatesResult>;
  /** 下载已发现的新版本（进度走 onUpdateStatus） */
  downloadUpdate(): Promise<{ ok: boolean }>;
  /** 退出应用并安装已下载完成的更新 */
  quitAndInstallUpdate(): Promise<void>;
  /** 订阅更新状态推送，返回取消订阅函数 */
  onUpdateStatus(cb: (state: UpdateState) => void): () => void;
  /** 区块结构操作（复制/上移/下移/删除），返回重解析结果 */
  sectionOp(args: SectionOpArgs): Promise<SectionOpResult>;
  /** 恢复整表区块结构后重解析（打开项目草稿） */
  setStructure(args: SetStructureArgs): Promise<ParseTemplateResult>;
  /** 扫描工作区外链图片清单（img/source/poster/CSS url() 等） */
  scanExternalImages(args: ScanExternalImagesArgs): Promise<ScanExternalImagesResult>;
  /** 下载外链图片到 assets/external 并改写全部引用；失败项原样保留并在报告中列明 */
  localizeImages(args: LocalizeImagesArgs): Promise<LocalizeImagesResult>;
  /** 主进程在「保存后退出」时通知渲染层落盘自动草稿 */
  onQuitSave(cb: () => void): () => void;
}

declare global {
  interface Window {
    wt: WebModifierApi;
  }
}
