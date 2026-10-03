// src/store/template-store.ts
// Zustand store：模板列表、当前模板、regions、选中区段、rects、iframe 控制

import { create, type StoreApi } from 'zustand';
import type { Region, RegionRect, TemplateMeta, WTConfig, PageMeta } from '@shared/types/region';
import type { ParentMessage } from '@shared/types/region';
import type {
  ProjectEdits,
  ProjectMeta,
  AutosaveMeta,
  CssEdits,
  SiteInjections,
  ExportTemplateResult,
  ApplySiteHeadArgs,
  SectionAction,
  LocalizeImagesResult
} from '@shared/types/ipc';
import type { StructureByPage } from '@shared/section-structure';
import {
  collectThemeVariables,
  patchThemeVariable,
  type ThemeFileInput,
  type ThemeVariable
} from '@shared/css-variables';
import {
  applySharedEdits,
  collectSharedEdits as collectSharedEditsPure,
  isSharedId,
  listSharedIds,
  reconcileSharedChanges,
  setSharedValue,
  stripSharedFromEdits,
  type SharedEdits
} from '@shared/shared-regions';
import type { HealthIssue } from '@shared/health-check';
import { replaceInRegions } from '@shared/find-replace';
import { buildRegionUpdateMessage } from '@shared/region-message';
import { serializeCss, parseCss, type CssBlock } from '@shared/css-utils';
import { overrideCssText, remapCssKeys } from '@shared/css-isolation';
import {
  relativeAssetRef,
  rewriteExternalRefs,
  type ExternalImage
} from '@shared/external-images';

const EMPTY_META: PageMeta = { title: '', description: '', favicon: '', lang: '' };

export type SidebarPanel = 'explorer' | 'history' | 'styles' | 'theme' | 'marketplace';

/* ---------------- 三栏宽度（localStorage 持久化） ---------------- */

export const PANEL_WIDTH_BOUNDS = {
  left: { min: 200, max: 480, default: 260 },
  right: { min: 240, max: 600, default: 320 }
} as const;

function readStoredWidth(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function persistWidth(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // 隐私模式等场景忽略写入失败
  }
}

// 编辑历史条目
export interface HistoryEntry {
  id: string;
  page: string; // 所属页面（历史按页隔离，撤销/重放不串页）
  regionId: string;
  regionLabel: string;
  oldValue: string;
  newValue: string;
  timestamp: number;
  /** 同一批操作（如全局查找替换）共享 group，撤销/重做时整组一次完成 */
  group?: string;
}

interface TemplateStoreState {
  templates: TemplateMeta[];
  // 项目草稿（保存工作区进度，不改动模板）
  projects: ProjectMeta[];
  currentProjectId: string | null;
  currentTemplate: string | null;
  // 多页网站支持
  pages: string[];
  currentPage: string;
  /**
   * 当前页的 region 视图（= regionsByPage[currentPage] 的引用）。
   * UI（Overlay/属性面板/导出按钮）只消费它；跨页同名 id 不会串数据。
   */
  regions: Region[];
  /** 全量：按页面分组的 region，携带用户当前编辑值 */
  regionsByPage: Record<string, Region[]>;
  /** 基线：模板打开/首次解析时的原始值快照，历史跳转（含回到初始状态）从它重建 */
  baselineByPage: Record<string, Region[]>;
  /**
   * 区块结构会话态（复制/上移/下移/删除 block 的结果），按页存放。
   * 仅在与模板默认结构不同时存在键；随项目草稿/自动草稿持久化，导出前由主进程应用。
   */
  structureByPage: StructureByPage;
  /** 各页面 <head> 元信息（title/description/favicon/lang） */
  metaByPage: Record<string, PageMeta>;
  /** 打开工作区时发现的待恢复自动草稿（用户选择恢复/放弃前不为 null） */
  pendingAutosave: AutosaveMeta | null;
  config: WTConfig | null;
  selectedRid: string | null;
  rectsByRid: Record<string, RegionRect>;
  // 递增令牌：用于强制 iframe 重载（删除组件等场景），替代清空 currentPage 的 hack
  iframeReloadToken: number;
  isLoading: boolean;
  error: string | null;
  lastExportPath: string | null;

  // VS Code 风格布局
  activePanel: SidebarPanel | null; // null = 折叠
  lastPanel: SidebarPanel; // 折叠前最后打开的面板（Ctrl+B 恢复用）
  openTabs: string[]; // 已打开的页面路径列表
  activeTab: string | null; // 当前激活的页面
  dirtyTabs: Record<string, boolean>; // 页面是否有未保存修改

  // 编辑历史（撤销/重做）
  history: HistoryEntry[];
  historyIndex: number; // -1 表示无历史

  // 导航历史（前进/后退）
  navHistory: string[];
  navIndex: number;

  // iframe 控制引用：由 IframeViewport 注册，由 PropertyPanel/Overlay 调用
  iframeApi: {
    postMessage: (msg: ParentMessage) => void;
  } | null;
  setIframeApi: (api: { postMessage: (msg: ParentMessage) => void } | null) => void;

  setTemplates: (templates: TemplateMeta[]) => void;
  setCurrentTemplate: (name: string | null) => void;
  setRegions: (regions: Region[]) => void;
  setConfig: (config: WTConfig | null) => void;
  setSelectedRid: (rid: string | null) => void;
  setRects: (rects: RegionRect[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLastExportPath: (path: string | null) => void;

  // 布局控制
  setActivePanel: (panel: SidebarPanel | null) => void;
  togglePanel: (panel: SidebarPanel) => void;
  /** 折叠/恢复侧边栏（恢复时回到最后打开的面板），Ctrl+B 用 */
  toggleSidebar: () => void;

  // 三栏宽度（可拖拽调整并持久化）
  leftWidth: number;
  rightWidth: number;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;

  // 标签页管理
  openTab: (page: string) => void;
  closeTab: (page: string) => void;
  setActiveTab: (page: string | null) => void;
  markTabDirty: (page: string, dirty: boolean) => void;

  // 编辑历史
  undo: () => void;
  redo: () => void;
  jumpToHistory: (index: number) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // 导航历史
  navigateBack: () => void;
  navigateForward: () => void;
  canNavigateBack: () => boolean;
  canNavigateForward: () => boolean;

  // 切换页面：清空选中与矩形（跨页状态不保留）
  setCurrentPage: (page: string) => void;

  updateRegionValue: (page: string, regionId: string, value: string) => void;
  /** 全局查找替换：在全部页面的可编辑文字区域中字面量替换；同一批次支持一次撤销 */
  replaceAcrossPages: (
    query: string,
    replacement: string,
    caseSensitive: boolean
  ) => { totalCount: number; pageCount: number; regionCount: number };
  /** iframe（重新）加载后，把当前页所有编辑值重放回文档，保证显示与 state 一致 */
  replayCurrentEdits: () => void;
  getRegionByRid: (rid: string) => Region | undefined;
  getRegionById: (id: string) => Region | undefined;
  /** 恢复模板到首次打开时的原件快照（整体回滚） */
  restoreTemplate: () => Promise<boolean>;
  fetchTemplates: () => Promise<void>;
  openTemplate: (name: string) => Promise<void>;
  parseTemplate: (name: string) => Promise<void>;
  /** 把工作区中的另一个模板导入为当前模板的新页面，返回新页面路径（失败 null） */
  importPage: (sourceTemplate: string, pageName?: string) => Promise<string | null>;
  /** 新建空白工作区并立即打开，返回实际模板名（失败 null） */
  createWorkspace: (name: string) => Promise<string | null>;
  /** 拉取项目草稿列表 */
  fetchProjects: () => Promise<void>;
  /** 保存当前编辑进度为草稿（有 currentProjectId 时更新原草稿，name 仅新建时使用），返回草稿 id */
  saveProject: (name?: string) => Promise<string | null>;
  /** 收集全部页面相对基线有改动的 region 值（草稿落盘内容；不含全站公共区） */
  collectProjectEdits: () => ProjectEdits;
  /** 收集全站公共区相对基线有改动的权威值（id → 全站唯一值） */
  collectSharedEdits: () => SharedEdits;
  /** 打开草稿：重新解析源模板并叠加保存的差异值 */
  openProject: (id: string) => Promise<boolean>;
  /** 删除草稿（不影响模板与导出）；若正在打开该草稿则退出草稿态 */
  removeProject: (id: string) => Promise<void>;
  exportTemplate: (exportName: string, targetDir?: string, zip?: boolean) => Promise<ExportTemplateResult | null>;
  /** 导出前健康检查（死链/缺图/空 title·description）；返回 null 表示检查本身失败 */
  checkExportHealth: () => Promise<{ pagesScanned: number; issues: HealthIssue[] } | null>;
  /** 把当前编辑态导出到临时目录并用系统默认浏览器打开（不经过导出对话框、不打 ZIP） */
  previewExternally: () => Promise<boolean>;
  resetTemplate: () => void;
  /** 回到主页：先落盘 CSS 与内容自动草稿，再卸载当前工作区（编辑不丢失） */
  goHome: () => Promise<void>;

  // 页面管理
  /** 重命名页面（自动重写全站站内链接），返回新页面路径 */
  renamePage: (page: string, newName: string) => Promise<string | null>;
  /** 复制页面（含资源），返回新页面路径 */
  duplicatePage: (page: string) => Promise<string | null>;
  /** 删除页面（其余页指向它的链接改回主页） */
  removePage: (page: string) => Promise<boolean>;
  /** 上移/下移页面，写回 config.pageOrder */
  movePage: (page: string, direction: -1 | 1) => Promise<void>;
  /** 保存页面 <head> 设置；成功后重新解析并重载预览 */
  savePageMeta: (page: string, meta: PageMeta) => Promise<boolean>;
  /** 全站 head 批量默认（favicon/标题/描述/OG），逐页写模板盘；返回扫描页/变更页数 */
  applySiteHead: (
    options: Omit<ApplySiteHeadArgs, 'templateName'>
  ) => Promise<{ pagesScanned: number; changedPages: number } | null>;

  /** 区块结构操作（仅 kind=block）：复制/上移/下移/删除，成功后重解析并重载预览 */
  sectionOp: (page: string, action: SectionAction, id: string) => Promise<boolean>;
  /** 恢复草稿时把结构表下发主会话并重解析（region 值叠加由调用方随后完成） */
  applyStructure: (structureByPage: StructureByPage) => Promise<boolean>;

  // 工作区管理
  /** 重命名当前工作区，返回实际新名（可能自动去重） */
  renameWorkspace: (newName: string) => Promise<string | null>;
  /** 当前工作区另存副本，返回新工作区名（不切换） */
  duplicateWorkspace: (newName?: string) => Promise<string | null>;
  /** 删除当前工作区并退出编辑会话 */
  deleteWorkspace: () => Promise<boolean>;

  // 自动草稿恢复
  /** 把待恢复草稿的差异叠加到当前会话 */
  restoreAutosave: () => Promise<boolean>;
  /** 放弃待恢复草稿 */
  discardAutosave: () => Promise<void>;

  // CSS 可视化编辑（差异只在会话与草稿中，不写模板磁盘）
  cssFiles: string[];
  cssCurrentFile: string | null;
  cssBlocks: CssBlock[];
  /** 已读取过的 CSS 文件基线（路径 → 规范化全文），用于判断是否有修改 */
  cssBaseline: Record<string, string>;
  /** 当前 CSS 覆盖（路径 → 规范化全文，仅保留与基线不同的文件） */
  cssOverrides: CssEdits;
  setCssFiles: (files: string[]) => void;
  setCssCurrentFile: (path: string | null) => void;
  setCssBlocks: (blocks: CssBlock[]) => void;
  loadCssFile: (path: string) => Promise<void>;
  /** 把当前 CSS 差异立即写入自动草稿（模板磁盘不受影响） */
  saveCssFile: () => Promise<void>;
  /** 兼容旧调用点：CSS 编辑实时提交到 cssOverrides，本方法为空操作 */
  flushCss: () => Promise<void>;
  /** 放弃当前文件的 CSS 修改：删除该文件覆盖、回到磁盘基线并重注入 */
  restoreCssFile: () => Promise<void>;
  /** 前端直接修改 block（实时预览），可指定文件路径，否则用 cssCurrentFile */
  updateCssBlock: (index: number, block: CssBlock, filePath?: string) => void;
  addCssBlock: (block: CssBlock) => void;
  removeCssBlock: (index: number) => void;

  // 主题变量（--var）聚合编辑：改值即写入对应 CSS 文件的 cssOverrides，
  // 预览/草稿/导出复用既有链路，不新增持久化通道
  themeVars: ThemeVariable[];
  themeLoading: boolean;
  /** 读取全部 CSS 文件并收集其中的主题变量（主题面板挂载时调用） */
  loadThemePanel: () => Promise<void>;
  /** 修改某文件某规则中的一条变量值，实时预览并安排自动草稿 */
  updateThemeVariable: (file: string, blockIndex: number, declIndex: number, value: string) => void;
  /** 一条变量恢复模板基线值 */
  resetThemeVariable: (file: string, blockIndex: number, declIndex: number) => void;
  /** 所有相对基线有改动的变量一次性恢复默认 */
  resetAllThemeVariables: () => void;

  // 全站自定义代码（与 CSS 同源：只存会话/草稿，模板本体不动，导出时注入导出副本）
  headInjection: string;
  bodyInjection: string;
  /** 收集非空白的 head/body 代码（草稿与导出统一入口） */
  collectInjections: () => SiteInjections;
  /** 对话框保存：更新代码、立即在预览中注入（script 可执行）并安排自动草稿 */
  setSiteInjections: (inj: SiteInjections) => void;

  // 外链图片本地化（下载到工作区 assets/external 并改写磁盘引用，同 page-meta 落盘路线）
  imageLocalizing: boolean;
  /** 扫描当前工作区全部外链图片（对话框打开时调用） */
  scanExternalImages: () => Promise<ExternalImage[] | null>;
  /** 下载选中（或全部）外链图片并改写引用；会话 region 值与 cssOverrides 同步调和 */
  localizeImages: (urls?: string[]) => Promise<LocalizeImagesResult | null>;
}

/* ---------------- 按页分组数据工具 ---------------- */

function cloneByPage(map: Record<string, Region[]>): Record<string, Region[]> {
  const out: Record<string, Region[]> = {};
  for (const [page, list] of Object.entries(map)) {
    out[page] = list.map((r) => ({ ...r, anchorRids: [...r.anchorRids] }));
  }
  return out;
}

function groupByPage(regions: Region[]): Record<string, Region[]> {
  const out: Record<string, Region[]> = {};
  for (const r of regions) {
    (out[r.page] ||= []).push({ ...r, anchorRids: [...r.anchorRids] });
  }
  return out;
}

/**
 * 重新解析后合并：新解析结果为准（组件增删/结构变化），
 * 但同页同 id 的 region 保留用户已编辑但尚未导出的值。
 */
export function mergeParsedRegions(
  previous: Record<string, Region[]> | null,
  incoming: Region[]
): Record<string, Region[]> {
  const valueMap = new Map<string, string>();
  if (previous) {
    for (const [page, list] of Object.entries(previous)) {
      for (const r of list) valueMap.set(`${page}::${r.id}`, r.value);
    }
  }
  const grouped = groupByPage(incoming);
  for (const [page, list] of Object.entries(grouped)) {
    for (const r of list) {
      const kept = valueMap.get(`${page}::${r.id}`);
      if (kept !== undefined) r.value = kept;
    }
  }
  return grouped;
}

/* ---------------- CSS 编辑的会话内覆盖（不写模板磁盘） ----------------
 * 每个 CSS 文件的当前编辑结果保存在 cssOverrides（路径 → 规范化全文），
 * 与模板基线 cssBaseline 相同的键自动剔除。预览通过注入 <style> 实时生效，
 * 差异随项目草稿/自动草稿持久化，导出时覆盖写入导出副本——模板本体永不被改。
 */

/* ---------------- 内容自动草稿（防抖） ----------------
 * region 编辑与 CSS 覆盖只存在于内存；每次编辑后防抖写入「每工作区一份」的
 * 自动草稿，崩溃/异常退出后再次打开可恢复。两类差异皆空时主进程自动删除草稿。
 */
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveSeq = 0;
// 会话闸门：打开工作区后、用户对「是否恢复草稿」做出选择前，禁止自动落盘，
// 否则基线值会立刻覆盖磁盘上待恢复的草稿
let autosaveArmed = false;
// 最近一次「已保存点」的差异快照（手动保存项目 / 打开项目 / 恢复草稿时设定）。
// 当前差异与它一致即视为干净：不写自动草稿，关窗也不打扰。
let savedEditsJson = '{}';
let savedCssJson = '{}';
let savedInjectionsJson = '{}';
let savedStructureJson = '{}';
let savedSharedJson = '{}';
const AUTOSAVE_DELAY = 800;

function editsToJson(edits: ProjectEdits): string {
  return JSON.stringify(edits);
}

function cssToJson(css: CssEdits): string {
  return JSON.stringify(css);
}

function injectionsToJson(inj: SiteInjections): string {
  return JSON.stringify(inj);
}

function structureToJson(structure: StructureByPage): string {
  return JSON.stringify(structure);
}

function sharedToJson(shared: SharedEdits): string {
  return JSON.stringify(shared);
}

function armAutosave(
  saved: ProjectEdits | 'empty',
  savedCss?: CssEdits,
  savedInjections?: SiteInjections,
  savedStructure?: StructureByPage,
  savedShared?: SharedEdits
): void {
  autosaveArmed = true;
  savedEditsJson = saved === 'empty' ? '{}' : editsToJson(saved);
  savedCssJson = cssToJson(savedCss ?? {});
  savedInjectionsJson = injectionsToJson(savedInjections ?? {});
  savedStructureJson = structureToJson(savedStructure ?? {});
  savedSharedJson = sharedToJson(savedShared ?? {});
}

function disarmAutosave(): void {
  autosaveArmed = false;
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  autosaveSeq++;
  savedEditsJson = '{}';
  savedCssJson = '{}';
  savedInjectionsJson = '{}';
  savedStructureJson = '{}';
  savedSharedJson = '{}';
}

function scheduleAutosave(): void {
  if (!autosaveArmed) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  const seq = ++autosaveSeq;
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    if (seq !== autosaveSeq) return;
    void persistAutosave();
  }, AUTOSAVE_DELAY);
}

/**
 * 立即同步当前编辑差异（内容 + CSS + 自定义代码）：与已保存点一致 → 清草稿 + 置干净；
 * 否则写自动草稿 + 置脏。返回当前是否为脏。
 */
async function persistAutosave(): Promise<boolean> {
  const state = useTemplateStore.getState();
  if (!state.currentTemplate) return false;
  const edits = state.collectProjectEdits();
  const cssEdits = state.cssOverrides;
  const injections = state.collectInjections();
  const structureByPage = state.structureByPage;
  const sharedEdits = state.collectSharedEdits();
  const json = editsToJson(edits);
  const cssJson = cssToJson(cssEdits);
  const injJson = injectionsToJson(injections);
  const structJson = structureToJson(structureByPage);
  const sharedJson = sharedToJson(sharedEdits);
  const dirty =
    json !== savedEditsJson ||
    cssJson !== savedCssJson ||
    injJson !== savedInjectionsJson ||
    structJson !== savedStructureJson ||
    sharedJson !== savedSharedJson;
  try {
    if (dirty) {
      await window.wt.saveAutosave({
        templateName: state.currentTemplate,
        edits,
        cssEdits,
        injections,
        structureByPage,
        sharedEdits
      });
    } else {
      await window.wt.deleteAutosave({ templateName: state.currentTemplate });
    }
    await window.wt.setDirty({ dirty });
  } catch {
    // 自动草稿失败不打扰编辑（错误提示由显式操作路径负责）
  }
  return dirty;
}

/** 关窗「保存并退出」时调用：内容与 CSS 草稿立即落盘 */
async function flushAllForQuit(): Promise<void> {
  if (!autosaveArmed) return;
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  autosaveSeq++;
  const state = useTemplateStore.getState();
  if (!state.currentTemplate) return;
  try {
    const edits = state.collectProjectEdits();
    const cssEdits = state.cssOverrides;
    const injections = state.collectInjections();
    const structureByPage = state.structureByPage;
    const sharedEdits = state.collectSharedEdits();
    if (
      editsToJson(edits) !== savedEditsJson ||
      cssToJson(cssEdits) !== savedCssJson ||
      injectionsToJson(injections) !== savedInjectionsJson ||
      structureToJson(structureByPage) !== savedStructureJson ||
      sharedToJson(sharedEdits) !== savedSharedJson
    ) {
      await window.wt.saveAutosave({
        templateName: state.currentTemplate,
        edits,
        cssEdits,
        injections,
        structureByPage,
        sharedEdits
      });
    }
  } catch {
    // 退出流程不阻塞于草稿失败
  }
}

/** 切换页面时的公共状态片段：region 视图换页 + 清空选中与矩形 */
function pageView(
  byPage: Record<string, Region[]>,
  page: string
): Pick<TemplateStoreState, 'currentPage' | 'regions' | 'selectedRid' | 'rectsByRid'> {
  return { currentPage: page, regions: byPage[page] ?? [], selectedRid: null, rectsByRid: {} };
}

type StoreSet = StoreApi<TemplateStoreState>['setState'];
type StoreGet = StoreApi<TemplateStoreState>['getState'];

/** 页面对应目录前缀（'about/index.html' → 'about/'；根页面为 ''） */
function pageDirPrefix(page: string): string {
  const i = page.lastIndexOf('/');
  return i >= 0 ? page.slice(0, i + 1) : '';
}

/** 页面改名后：把所有以页面路径为键/引用的会话状态从 oldPage 迁到 newPage */
function remapPageKey(set: StoreSet, get: StoreGet, oldPage: string, newPage: string): void {
  const remap = <T,>(m: Record<string, T>): Record<string, T> => {
    if (!(oldPage in m)) return m;
    const next: Record<string, T> = {};
    for (const [k, v] of Object.entries(m)) next[k === oldPage ? newPage : k] = v;
    return next;
  };
  const s = get();
  const oldPrefix = pageDirPrefix(oldPage);
  const newPrefix = pageDirPrefix(newPage);
  const remapCssPath = (p: string | null): string | null =>
    p && oldPrefix && p.startsWith(oldPrefix) ? newPrefix + p.slice(oldPrefix.length) : p;
  set({
    regionsByPage: remap(s.regionsByPage),
    baselineByPage: remap(s.baselineByPage),
    structureByPage: remap(s.structureByPage),
    metaByPage: remap(s.metaByPage),
    currentPage: s.currentPage === oldPage ? newPage : s.currentPage,
    activeTab: s.activeTab === oldPage ? newPage : s.activeTab,
    openTabs: s.openTabs.map((t) => (t === oldPage ? newPage : t)),
    navHistory: s.navHistory.map((p) => (p === oldPage ? newPage : p)),
    history: s.history.map((h) => (h.page === oldPage ? { ...h, page: newPage } : h)),
    dirtyTabs: remap(s.dirtyTabs),
    cssBaseline: remapCssKeys(s.cssBaseline, oldPrefix, newPrefix),
    cssOverrides: remapCssKeys(s.cssOverrides, oldPrefix, newPrefix),
    cssCurrentFile: remapCssPath(s.cssCurrentFile)
  });
}

interface StructureReloadOpts {
  /** 是否强制 iframe 重载（链接可能被重写时需要；纯新增页面可关） */
  bumpReload?: boolean;
  /** 被删除的页面：用于清理标签与导航 */
  removedPage?: string;
}

/**
 * 页面增删改名后统一刷新：重新解析（保留未受影响 region 的编辑值）、
 * 修正当前页/标签/导航、刷新 CSS 文件列表，必要时强制重载 iframe。
 */
async function reloadAfterStructure(
  set: StoreSet,
  get: StoreGet,
  templateName: string,
  opts: StructureReloadOpts = {}
): Promise<void> {
  const res = await window.wt.parseTemplate(templateName);
  const byPage = mergeParsedRegions(get().regionsByPage, res.regions);
  const baseline = mergeParsedRegions(get().baselineByPage, res.regions);
  const s0 = get();
  let current = s0.currentPage;
  if (opts.removedPage === current || !res.pages.includes(current)) {
    current = res.pages[0] || 'index.html';
  }

  let openTabs = s0.openTabs.slice();
  if (opts.removedPage) openTabs = openTabs.filter((t) => t !== opts.removedPage);
  if (!openTabs.includes(current)) openTabs.push(current);
  const activeTab =
    s0.activeTab && s0.activeTab !== opts.removedPage && openTabs.includes(s0.activeTab)
      ? s0.activeTab
      : current;
  const navHistory = s0.navHistory
    .map((p) => (p === opts.removedPage ? current : p))
    .filter((p) => res.pages.includes(p));
  let navIndex = s0.navIndex;
  if (!res.pages.includes(navHistory[navIndex] ?? '')) navIndex = navHistory.indexOf(current);
  const dirtyTabs = { ...s0.dirtyTabs };
  if (opts.removedPage) delete dirtyTabs[opts.removedPage];

  set({
    pages: res.pages,
    regionsByPage: byPage,
    baselineByPage: baseline,
    metaByPage: res.metaByPage ?? {},
    config: res.config,
    currentPage: current,
    regions: byPage[current] ?? [],
    selectedRid: null,
    rectsByRid: {},
    openTabs,
    activeTab,
    navHistory: navHistory.length > 0 ? navHistory : [current],
    navIndex: navIndex >= 0 ? navIndex : 0,
    dirtyTabs,
    ...(opts.bumpReload === false ? {} : { iframeReloadToken: s0.iframeReloadToken + 1 })
  });

  // 页面目录整体移动/删除会影响 CSS 文件集合：刷新列表并清理已消失文件的会话状态
  try {
    const cssRes = await window.wt.listCssFiles({ templateName });
    const cssFiles = cssRes.files;
    const s1 = get();
    const removedPrefix = opts.removedPage ? pageDirPrefix(opts.removedPage) : '';
    const stripPrefix = <T,>(m: Record<string, T>): Record<string, T> => {
      if (!removedPrefix) return m;
      let changed = false;
      const next: Record<string, T> = {};
      for (const [k, v] of Object.entries(m)) {
        if (k.startsWith(removedPrefix)) {
          changed = true;
          continue;
        }
        next[k] = v;
      }
      return changed ? next : m;
    };
    const currentCss = s1.cssCurrentFile;
    const currentGone = !!currentCss && !cssFiles.includes(currentCss);
    set({
      cssFiles,
      cssBaseline: stripPrefix(s1.cssBaseline),
      cssOverrides: stripPrefix(s1.cssOverrides),
      ...(currentGone ? { cssCurrentFile: null, cssBlocks: [] } : {})
    });
    // 覆盖集合可能因删除而变小，重注入一次（iframe 随后通常也会因 reload 重放）
    s1.iframeApi?.postMessage({
      type: 'wt-css-update',
      cssText: overrideCssText(cssFiles, get().cssOverrides)
    });
  } catch {
    // CSS 刷新失败不阻塞结构变更
  }
}

/**
 * 把项目草稿/自动草稿中的 CSS 差异叠加到会话：
 * 逐个读模板磁盘文件建立基线；文件已不存在的差异丢弃；随后全量注入预览。
 */
async function applyCssEdits(
  set: StoreSet,
  get: StoreGet,
  cssEdits?: CssEdits | null
): Promise<void> {
  const templateName = get().currentTemplate;
  if (!templateName) return;
  const overrides: CssEdits = {};
  const baseline: Record<string, string> = {};
  await Promise.all(
    Object.entries(cssEdits ?? {}).map(async ([p, text]) => {
      try {
        const res = await window.wt.readCssFile({ templateName, path: p });
        baseline[p] = serializeCss(res.blocks);
        overrides[p] = text;
      } catch {
        // CSS 文件已不存在（页面/目录被删）→ 丢弃该差异
      }
    })
  );
  set({ cssOverrides: overrides, cssBaseline: baseline, cssCurrentFile: null, cssBlocks: [] });
  get().iframeApi?.postMessage({
    type: 'wt-css-update',
    cssText: overrideCssText(get().cssFiles, overrides)
  });
}

/** 把项目草稿/自动草稿中的全站自定义代码叠加到会话并注入预览 */
function applySiteInjections(set: StoreSet, get: StoreGet, inj?: SiteInjections | null): void {
  const head = inj?.head ?? '';
  const body = inj?.body ?? '';
  set({ headInjection: head, bodyInjection: body });
  get().iframeApi?.postMessage({ type: 'wt-inject-update', head, body });
}

/**
 * 提交当前 CSS 文件的一次结构化编辑：更新 blocks 与该文件的覆盖全文
 * （与基线相同则剔除键），全量重注入预览，并安排自动草稿。
 */
function commitCssBlocks(set: StoreSet, get: StoreGet, next: CssBlock[]): void {
  const file = get().cssCurrentFile;
  if (!file) return;
  const text = serializeCss(next);
  set((state) => {
    const cssOverrides = { ...state.cssOverrides };
    if (state.cssBaseline[file] !== undefined && text === state.cssBaseline[file]) {
      delete cssOverrides[file];
    } else {
      cssOverrides[file] = text;
    }
    return { cssBlocks: next, cssOverrides };
  });
  get().iframeApi?.postMessage({
    type: 'wt-css-update',
    cssText: overrideCssText(get().cssFiles, get().cssOverrides)
  });
  scheduleAutosave();
}

/* ---------------- 主题变量（--var）聚合编辑 ----------------
 * 主题面板跨文件读取变量，编辑本质是改某 CSS 文件 :root/.dark 等规则里的一条
 * 声明，仍归一化到 cssOverrides（路径→全文）链路：预览注入、草稿持久化、导出
 * 全部复用，不写模板磁盘。themeBlocksCache 暂存每个文件的当前块供精确定位补丁，
 * loadThemePanel 全量重建；打开其它模板时由 load 覆盖，resetTemplate 清空。
 */
const themeBlocksCache: Record<string, CssBlock[]> = {};

/** 会话切换/重置时清空主题块缓存与面板数据（配合 set 中的 themeVars 重置） */
function clearThemeBlocksCache(): void {
  for (const key of Object.keys(themeBlocksCache)) delete themeBlocksCache[key];
}

/** 提交某文件的一版主题块：更新覆盖表（回到基线则剔除键）、缓存、重注入、排草稿 */
function commitThemeFile(
  set: StoreSet,
  get: StoreGet,
  file: string,
  nextBlocks: CssBlock[]
): void {
  const text = serializeCss(nextBlocks);
  set((state) => {
    const cssOverrides = { ...state.cssOverrides };
    if (state.cssBaseline[file] !== undefined && text === state.cssBaseline[file]) {
      delete cssOverrides[file];
    } else {
      cssOverrides[file] = text;
    }
    // 样式面板正打开同一文件时保持其块视图同步
    const cssBlocks = state.cssCurrentFile === file ? nextBlocks : state.cssBlocks;
    return { cssOverrides, cssBlocks };
  });
  themeBlocksCache[file] = nextBlocks;
  get().iframeApi?.postMessage({
    type: 'wt-css-update',
    cssText: overrideCssText(get().cssFiles, get().cssOverrides)
  });
  scheduleAutosave();
}

export const useTemplateStore = create<TemplateStoreState>((set, get) => ({
  templates: [],
  projects: [],
  currentProjectId: null,
  currentTemplate: null,
  pages: [],
  currentPage: 'index.html',
  regions: [],
  regionsByPage: {},
  baselineByPage: {},
  structureByPage: {},
  metaByPage: {},
  pendingAutosave: null,
  config: null,
  selectedRid: null,
  rectsByRid: {},
  iframeReloadToken: 0,
  isLoading: false,
  error: null,
  lastExportPath: null,

  // 布局（启动时收起侧栏，主区域显示主页；lastPanel 供 Ctrl+B 恢复）
  activePanel: null,
  lastPanel: 'marketplace',
  openTabs: [],
  activeTab: null,
  dirtyTabs: {},

  // 编辑历史
  history: [],
  historyIndex: -1,

  // 导航历史
  navHistory: [],
  navIndex: -1,

  // CSS 可视化编辑
  cssFiles: [],
  cssCurrentFile: null,
  cssBlocks: [],
  cssBaseline: {},
  cssOverrides: {},

  // 主题变量聚合面板
  themeVars: [],
  themeLoading: false,

  // 全站自定义代码
  headInjection: '',
  bodyInjection: '',

  // 外链图片本地化
  imageLocalizing: false,

  iframeApi: null,

  setIframeApi: (iframeApi) => set({ iframeApi }),

  setTemplates: (templates) => set({ templates }),
  setCurrentTemplate: (name) => set({ currentTemplate: name }),
  setRegions: (regions) => set({ regions }),
  setConfig: (config) => set({ config }),
  setSelectedRid: (rid) => set({ selectedRid: rid }),
  setRects: (rects) => {
    const map: Record<string, RegionRect> = {};
    for (const r of rects) map[r.rid] = r;
    set({ rectsByRid: map });
  },
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setLastExportPath: (lastExportPath) => set({ lastExportPath }),

  setActivePanel: (panel) =>
    set((state) => ({ activePanel: panel, lastPanel: panel ?? state.lastPanel })),
  togglePanel: (panel) =>
    set((state) => ({
      activePanel: state.activePanel === panel ? null : panel,
      lastPanel: state.activePanel === panel ? state.lastPanel : panel
    })),
  toggleSidebar: () =>
    set((state) => ({
      activePanel: state.activePanel ? null : state.lastPanel
    })),

  leftWidth: readStoredWidth('wt-left-width', PANEL_WIDTH_BOUNDS.left.default),
  rightWidth: readStoredWidth('wt-right-width', PANEL_WIDTH_BOUNDS.right.default),
  setLeftWidth: (w) => {
    const { min, max } = PANEL_WIDTH_BOUNDS.left;
    const clamped = Math.round(Math.min(max, Math.max(min, w)));
    persistWidth('wt-left-width', clamped);
    set({ leftWidth: clamped });
  },
  setRightWidth: (w) => {
    const { min, max } = PANEL_WIDTH_BOUNDS.right;
    const clamped = Math.round(Math.min(max, Math.max(min, w)));
    persistWidth('wt-right-width', clamped);
    set({ rightWidth: clamped });
  },

  openTab: (page) =>
    set((state) => {
      const view = pageView(state.regionsByPage, page);
      // 已在当前页：仅刷新视图（不重复记录导航历史）
      if (state.navHistory[state.navIndex] === page) {
        return { ...view };
      }
      // 记录导航历史：裁剪当前位置之后的历史（新分支）
      const trimmed = state.navHistory.slice(0, state.navIndex + 1);
      trimmed.push(page);
      return {
        ...(state.openTabs.includes(page) ? {} : { openTabs: [...state.openTabs, page] }),
        ...view,
        activeTab: page,
        navHistory: trimmed,
        navIndex: trimmed.length - 1
      };
    }),

  closeTab: (page) =>
    set((state) => {
      const idx = state.openTabs.indexOf(page);
      if (idx === -1) return {};
      const newTabs = state.openTabs.filter((t) => t !== page);
      const newDirty = { ...state.dirtyTabs };
      delete newDirty[page];
      let activeTab = state.activeTab;
      if (state.activeTab === page) {
        activeTab = newTabs.length === 0 ? null : newTabs[Math.min(idx, newTabs.length - 1)];
      }
      if (activeTab === null) {
        return {
          openTabs: newTabs,
          activeTab: null,
          currentPage: state.currentPage,
          regions: [],
          selectedRid: null,
          rectsByRid: {},
          dirtyTabs: newDirty
        };
      }
      // 激活相邻标签：同步 region 视图；不改动导航历史
      if (state.activeTab === page) {
        return {
          openTabs: newTabs,
          activeTab,
          dirtyTabs: newDirty,
          ...pageView(state.regionsByPage, activeTab)
        };
      }
      return { openTabs: newTabs, activeTab, dirtyTabs: newDirty };
    }),

  setActiveTab: (page) =>
    set((state) => {
      if (!page) return { activeTab: null };
      const view = pageView(state.regionsByPage, page);
      if (state.navHistory[state.navIndex] === page) {
        return { activeTab: page, ...view };
      }
      const trimmed = state.navHistory.slice(0, state.navIndex + 1);
      trimmed.push(page);
      return {
        activeTab: page,
        ...view,
        navHistory: trimmed,
        navIndex: trimmed.length - 1
      };
    }),

  markTabDirty: (page, dirty) =>
    set((state) => ({ dirtyTabs: { ...state.dirtyTabs, [page]: dirty } })),

  // 撤销：回退当前历史指针处的条目（按页定位 region）。
  // 同一 group（全局替换等批量操作）的连续条目一次撤销完。
  undo: () => {
    let state = get();
    if (state.historyIndex < 0) return;
    const group = state.history[state.historyIndex].group;
    for (;;) {
      const idx = state.historyIndex;
      if (idx < 0) break;
      const entry = state.history[idx];
      // 公共区条目：值回退到所有出现页（历史中同 id 只有一条）
      if (isSharedId(state.regionsByPage, entry.regionId)) {
        const byPage = setSharedValue(state.regionsByPage, entry.regionId, entry.oldValue);
        const dirtyTabs = { ...state.dirtyTabs };
        for (const p of state.pages) {
          if (byPage[p]?.some((r) => r.id === entry.regionId)) dirtyTabs[p] = true;
        }
        set({
          regionsByPage: byPage,
          regions: byPage[state.currentPage] ?? state.regions,
          historyIndex: idx - 1,
          dirtyTabs
        });
        if (state.currentPage) {
          const target = byPage[state.currentPage]?.find((r) => r.id === entry.regionId);
          if (target) get().iframeApi?.postMessage(buildRegionUpdateMessage(target, entry.oldValue));
        }
      } else {
        const pageList = state.regionsByPage[entry.page];
        if (pageList) {
          const nextList = pageList.map((r) =>
            r.id === entry.regionId ? { ...r, value: entry.oldValue } : r
          );
          const byPage = { ...state.regionsByPage, [entry.page]: nextList };
          set({
            regionsByPage: byPage,
            regions: entry.page === state.currentPage ? nextList : state.regions,
            historyIndex: idx - 1,
            dirtyTabs: { ...state.dirtyTabs, [entry.page]: true }
          });
          // 仅当被撤销的页面正显示时同步 iframe；其它页切回时由 replayCurrentEdits 兜底
          if (entry.page === state.currentPage) {
            const target = nextList.find((r) => r.id === entry.regionId);
            if (target) get().iframeApi?.postMessage(buildRegionUpdateMessage(target, entry.oldValue));
          }
        } else {
          set({ historyIndex: idx - 1 });
        }
      }
      if (!group || idx - 1 < 0 || state.history[idx - 1].group !== group) break;
      state = get();
    }
  },

  // 重做：前进到下一个历史条目；同 group 连续条目一次重做完
  redo: () => {
    let state = get();
    if (state.historyIndex >= state.history.length - 1) return;
    const group = state.history[state.historyIndex + 1].group;
    for (;;) {
      const idx = state.historyIndex + 1;
      if (idx >= state.history.length) break;
      const entry = state.history[idx];
      if (isSharedId(state.regionsByPage, entry.regionId)) {
        const byPage = setSharedValue(state.regionsByPage, entry.regionId, entry.newValue);
        const dirtyTabs = { ...state.dirtyTabs };
        for (const p of state.pages) {
          if (byPage[p]?.some((r) => r.id === entry.regionId)) dirtyTabs[p] = true;
        }
        set({
          regionsByPage: byPage,
          regions: byPage[state.currentPage] ?? state.regions,
          historyIndex: idx,
          dirtyTabs
        });
        if (state.currentPage) {
          const target = byPage[state.currentPage]?.find((r) => r.id === entry.regionId);
          if (target) get().iframeApi?.postMessage(buildRegionUpdateMessage(target, entry.newValue));
        }
      } else {
        const pageList = state.regionsByPage[entry.page];
        if (pageList) {
          const nextList = pageList.map((r) =>
            r.id === entry.regionId ? { ...r, value: entry.newValue } : r
          );
          const byPage = { ...state.regionsByPage, [entry.page]: nextList };
          set({
            regionsByPage: byPage,
            regions: entry.page === state.currentPage ? nextList : state.regions,
            historyIndex: idx,
            dirtyTabs: { ...state.dirtyTabs, [entry.page]: true }
          });
          if (entry.page === state.currentPage) {
            const target = nextList.find((r) => r.id === entry.regionId);
            if (target) get().iframeApi?.postMessage(buildRegionUpdateMessage(target, entry.newValue));
          }
        } else {
          set({ historyIndex: idx });
        }
      }
      if (!group || idx + 1 >= state.history.length || state.history[idx + 1].group !== group) break;
      state = get();
    }
  },

  /**
   * 跳转到指定历史位置：-1 = 模板打开时的初始状态。
   * 从基线快照重建全部页面，再顺序应用 0..index 的编辑，保证任意跳转结果正确
   * （含跨页编辑、同一 region 多次编辑、撤销后又改了别的 region 的场景）。
   */
  jumpToHistory: (index) => {
    const state = get();
    if (index < -1 || index >= state.history.length) return;
    const byPage = cloneByPage(state.baselineByPage);
    const sharedIds = listSharedIds(Object.values(byPage).flat());
    for (let i = 0; i <= index; i++) {
      const entry = state.history[i];
      // 公共区条目：值铺到所有出现页，跳过同 id 在按页循环中的重复
      if (sharedIds.has(entry.regionId)) {
        const patched = setSharedValue(byPage, entry.regionId, entry.newValue);
        for (const [p, list] of Object.entries(patched)) byPage[p] = list;
        continue;
      }
      const list = byPage[entry.page];
      if (!list) continue;
      const idx = list.findIndex((r) => r.id === entry.regionId);
      if (idx >= 0) list[idx] = { ...list[idx], value: entry.newValue };
    }
    set({
      regionsByPage: byPage,
      regions: byPage[state.currentPage] ?? [],
      historyIndex: index
    });
    // 重放当前页全部值到 iframe（被跳走/跳回的内容都要可见）
    get().replayCurrentEdits();
  },

  canUndo: () => get().historyIndex >= 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  navigateBack: () =>
    set((state) => {
      if (state.navIndex <= 0) return {};
      const newIndex = state.navIndex - 1;
      const page = state.navHistory[newIndex];
      return { navIndex: newIndex, activeTab: page, ...pageView(state.regionsByPage, page) };
    }),

  navigateForward: () =>
    set((state) => {
      if (state.navIndex >= state.navHistory.length - 1) return {};
      const newIndex = state.navIndex + 1;
      const page = state.navHistory[newIndex];
      return { navIndex: newIndex, activeTab: page, ...pageView(state.regionsByPage, page) };
    }),

  canNavigateBack: () => get().navIndex > 0,
  canNavigateForward: () => get().navIndex < get().navHistory.length - 1,

  setCurrentPage: (page) =>
    set((state) => pageView(state.regionsByPage, page)),

  updateRegionValue: (page, regionId, value) =>
    set((state) => {
      const pageList = state.regionsByPage[page];
      const region = pageList?.find((r) => r.id === regionId);
      if (!region) return {};
      const oldValue = region.value;
      if (oldValue === value) return {};
      // 新分支操作：裁剪 redo 栈
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        page,
        regionId,
        regionLabel: region.label || regionId,
        oldValue,
        newValue: value,
        timestamp: Date.now()
      };
      newHistory.push(entry);
      // 全站公共区：一个值写入所有出现页（历史只记一条，撤销/重做整体回退）
      if (region.shared) {
        const byPage = setSharedValue(state.regionsByPage, regionId, value);
        const dirtyTabs = { ...state.dirtyTabs };
        for (const [p, list] of Object.entries(byPage)) {
          if (list.some((r) => r.id === regionId)) dirtyTabs[p] = true;
        }
        return {
          regionsByPage: byPage,
          regions: byPage[state.currentPage] ?? state.regions,
          history: newHistory,
          historyIndex: newHistory.length - 1,
          dirtyTabs
        };
      }
      const nextList = pageList.map((r) => (r.id === regionId ? { ...r, value } : r));
      return {
        regionsByPage: { ...state.regionsByPage, [page]: nextList },
        regions: page === state.currentPage ? nextList : state.regions,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        dirtyTabs: { ...state.dirtyTabs, [page]: true }
      };
    }),

  // 全局查找替换：跨全部页面的可编辑文字区域做字面量替换。
  // 所有变更共享一个 history group，撤销/重做一次完成；当前页的变更实时同步 iframe。
  replaceAcrossPages: (query, replacement, caseSensitive) => {
    const state = get();
    if (!query) return { totalCount: 0, pageCount: 0, regionCount: 0 };

    const group = `fr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    const byPage: typeof state.regionsByPage = {};
    const dirtyTabs = { ...state.dirtyTabs };
    let totalCount = 0;
    let regionCount = 0;
    const changedPages = new Set<string>();
    // 记录当前页需要同步给 iframe 的 region（新值）
    const syncToIframe: Region[] = [];

    for (const [page, list] of Object.entries(state.regionsByPage)) {
      const res = replaceInRegions(list, query, replacement, { caseSensitive });
      if (!res.changed.length) continue;
      byPage[page] = res.regions;
      dirtyTabs[page] = true;
      changedPages.add(page);
      for (const ch of res.changed) {
        const original = list.find((r) => r.id === ch.regionId);
        if (!original) continue;
        // 公共区的历史条目在调和后按 id 只记一条，这里不逐页入栈
        if (!original.shared) {
          newHistory.push({
            id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
            page,
            regionId: ch.regionId,
            regionLabel: original.label || ch.regionId,
            oldValue: original.value,
            newValue: ch.newValue,
            timestamp: now,
            group
          });
        }
        totalCount += ch.count;
        regionCount += 1;
        if (page === state.currentPage) {
          syncToIframe.push({ ...original, value: ch.newValue });
        }
      }
    }

    // 公共区调和：各页替换结果统一为首个变化页的新值（未命中页也强制同步）
    const reconciled = reconcileSharedChanges({
      pages: state.pages,
      prevByPage: state.regionsByPage,
      nextByPage: byPage
    });
    if (reconciled.changes.length > 0) {
      for (const [page, list] of Object.entries(reconciled.patch)) {
        byPage[page] = list;
        dirtyTabs[page] = true;
        changedPages.add(page);
      }
      for (const ch of reconciled.changes) {
        newHistory.push({
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          page: ch.page,
          regionId: ch.id,
          regionLabel: ch.id,
          oldValue: ch.oldValue,
          newValue: ch.newValue,
          timestamp: now,
          group
        });
        const cur = reconciled.patch[state.currentPage]?.find((r) => r.id === ch.id);
        if (cur) syncToIframe.push(cur);
      }
    }

    if (totalCount === 0) return { totalCount: 0, pageCount: 0, regionCount: 0 };

    set({
      regionsByPage: { ...state.regionsByPage, ...byPage },
      regions: byPage[state.currentPage] ?? state.regions,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      dirtyTabs
    });
    // 调和可能给当前页追加了同步项，去重（同 id 取最后一个）
    const iframeOnce = new Map<string, Region>();
    for (const r of syncToIframe) iframeOnce.set(r.id, r);
    for (const r of iframeOnce.values()) {
      state.iframeApi?.postMessage(buildRegionUpdateMessage(r, r.value));
    }
    return { totalCount, pageCount: changedPages.size, regionCount };
  },

  // iframe 文档（重新）加载后调用：把当前页全部 region 的当前值发回文档，
  // 修复切页/重载后显示层回退为原始 HTML 的问题
  replayCurrentEdits: () => {
    const state = get();
    const api = state.iframeApi;
    if (!api) return;
    for (const r of state.regions) {
      api.postMessage(buildRegionUpdateMessage(r, r.value));
    }
  },

  getRegionByRid: (rid) => get().regions.find((r) => r.anchorRids.includes(rid)),
  getRegionById: (id) => get().regions.find((r) => r.id === id),

  restoreTemplate: async () => {
    const { currentTemplate, currentPage } = get();
    if (!currentTemplate) return false;
    try {
      const res = await window.wt.resetTemplate({ templateName: currentTemplate });
      if (!res.ok) {
        set({ error: '该模板没有可用的原件快照，无法恢复' });
        return false;
      }
      // 快照已回滚到磁盘，重新解析并强制 iframe 重载
      const parsed = await window.wt.parseTemplate(currentTemplate);
      const targetPage = parsed.pages.includes(currentPage) ? currentPage : parsed.pages[0] || 'index.html';
      const byPage = mergeParsedRegions(null, parsed.regions);
      // 磁盘已整体回滚：旧的自动草稿与待恢复提示一并作废
      try {
        await window.wt.deleteAutosave({ templateName: currentTemplate });
      } catch {
        // 忽略清理失败
      }
      await window.wt.setDirty({ dirty: false });
      armAutosave('empty');
      set({
        pages: parsed.pages,
        regionsByPage: byPage,
        baselineByPage: cloneByPage(byPage),
        structureByPage: {},
        metaByPage: parsed.metaByPage ?? {},
        pendingAutosave: null,
        currentPage: targetPage,
        regions: byPage[targetPage] ?? [],
        config: parsed.config,
        selectedRid: null,
        rectsByRid: {},
        iframeReloadToken: get().iframeReloadToken + 1,
        // 整体恢复后编辑历史不再有意义
        history: [],
        historyIndex: -1,
        // CSS 编辑状态必须一并重置：否则 iframe 重载后 wt-ready 会把内存中
        // 的 CSS 覆盖重新注入新文档，造成「样式怎么都恢复不掉」
        cssCurrentFile: null,
        cssBlocks: [],
        cssBaseline: {},
        cssOverrides: {},
        themeVars: [],
        themeLoading: false,
        headInjection: '',
        bodyInjection: '',
        imageLocalizing: false,
        error: null
      });
      return true;
    } catch (e) {
      set({ error: `恢复模板失败: ${String(e)}` });
      return false;
    }
  },

  fetchTemplates: async () => {
    try {
      const res = await window.wt.listTemplates();
      set({ templates: res.templates });
    } catch (e) {
      set({ error: `加载模板列表失败: ${String(e)}` });
    }
  },

  openTemplate: async (name) => {
    // 新会话在「是否恢复草稿」决定前禁止自动落盘
    disarmAutosave();
    clearThemeBlocksCache();
    await window.wt.setDirty({ dirty: false }).catch(() => undefined);
    set({
      isLoading: true,
      error: null,
      currentTemplate: name,
      // 直接打开模板 = 新的未保存编辑会话（打开草稿时 openProject 会在之后重新置位）
      currentProjectId: null,
      currentPage: '', // 先清空，等解析完成后再设值；此期间 IframeViewport 显示加载占位而非旧页
      regions: [],
      regionsByPage: {},
      baselineByPage: {},
      structureByPage: {},
      metaByPage: {},
      pendingAutosave: null,
      selectedRid: null,
      rectsByRid: {},
      openTabs: [],
      activeTab: null,
      dirtyTabs: {},
      history: [],
      historyIndex: -1,
      navHistory: [],
      navIndex: -1,
      // CSS 编辑器状态重置（覆盖只存会话/草稿，模板本体不变）
      cssFiles: [],
      cssCurrentFile: null,
      cssBlocks: [],
      cssBaseline: {},
      cssOverrides: {},
      // 主题面板缓存随会话重置（面板数据在下次打开时重新加载）
      themeVars: [],
      themeLoading: false,
      // 全站自定义代码同样随会话重置
      headInjection: '',
      bodyInjection: '',
      imageLocalizing: false
    });
    try {
      const res = await window.wt.parseTemplate(name);
      const firstPage = res.pages[0] || 'index.html';
      // 首次解析：按页分组即为基线（两份独立拷贝，基线永不被编辑污染）
      const byPage = mergeParsedRegions(null, res.regions);
      set({
        pages: res.pages,
        currentPage: firstPage,
        regionsByPage: byPage,
        baselineByPage: cloneByPage(byPage),
        metaByPage: res.metaByPage ?? {},
        regions: byPage[firstPage] ?? [],
        config: res.config,
        openTabs: [firstPage],
        activeTab: firstPage,
        navHistory: [firstPage],
        navIndex: 0
      });
      // 自动扫描模板内 CSS 文件（样式面板用）
      try {
        const cssRes = await window.wt.listCssFiles({ templateName: name });
        set({ cssFiles: cssRes.files });
      } catch {
        // 扫描失败不阻塞模板打开
        set({ cssFiles: [] });
      }
      // 探测上次崩溃/异常退出留下的自动草稿：有则提示恢复，期间保持 disarm
      try {
        const { autosave } = await window.wt.getAutosave({ templateName: name });
        if (autosave) {
          set({
            pendingAutosave: {
              templateName: autosave.templateName,
              updatedAt: autosave.updatedAt,
              editCount: autosave.editCount,
              cssCount: autosave.cssCount ?? 0,
              injectionCount: autosave.injectionCount ?? 0
            }
          });
          return; // 等用户选择恢复/放弃后再 arm
        }
      } catch {
        // 探测失败按无草稿处理
      }
      armAutosave('empty');
    } catch (e) {
      set({ error: `打开模板失败: ${String(e)}` });
    } finally {
      set({ isLoading: false });
    }
  },

  parseTemplate: async (name) => {
    try {
      const res = await window.wt.parseTemplate(name);
      const byPage = mergeParsedRegions(get().regionsByPage, res.regions);
      set({
        pages: res.pages,
        regionsByPage: byPage,
        regions: byPage[get().currentPage] ?? [],
        metaByPage: res.metaByPage ?? {},
        config: res.config,
        selectedRid: null,
        rectsByRid: {}
      });
    } catch (e) {
      set({ error: `解析模板失败: ${String(e)}` });
    }
  },

  // 从工作区模板导入新页面：主进程复制子目录 → 重新解析（保留其它页编辑值）
  // → 刷新 CSS 文件列表 → 自动打开新页面标签
  importPage: async (sourceTemplate, pageName) => {
    const { currentTemplate } = get();
    if (!currentTemplate) return null;
    try {
      const res = await window.wt.importPage({
        templateName: currentTemplate,
        sourceTemplate,
        pageName
      });
      await get().parseTemplate(currentTemplate);
      try {
        const cssRes = await window.wt.listCssFiles({ templateName: currentTemplate });
        set({ cssFiles: cssRes.files });
      } catch {
        // CSS 扫描失败不阻塞页面导入
      }
      get().openTab(res.pagePath);
      set({ error: null });
      return res.pagePath;
    } catch (e) {
      set({ error: `导入页面失败: ${String(e)}` });
      return null;
    }
  },

  // 新建工作区：主进程生成起始页/样式/快照 → 刷新列表 → 直接打开
  createWorkspace: async (name) => {
    try {
      const res = await window.wt.createWorkspace({ name });
      await get().fetchTemplates();
      await get().openTemplate(res.name);
      set({ error: null });
      return res.name;
    } catch (e) {
      set({ error: `新建工作区失败: ${String(e)}` });
      return null;
    }
  },

  // ---------- 项目草稿 ----------

  fetchProjects: async () => {
    try {
      const res = await window.wt.listProjects();
      set({ projects: res.projects });
    } catch (e) {
      set({ error: `加载项目列表失败: ${String(e)}` });
    }
  },

  // 收集相对基线有改动的 region 值（按页 → id），草稿只存差异。
  // 全站公共区（shared）不进按页 edits，由 collectSharedEdits 单独权威存储。
  collectProjectEdits: (): ProjectEdits => {
    const { regionsByPage, baselineByPage } = get();
    const edits: ProjectEdits = {};
    for (const [page, list] of Object.entries(regionsByPage)) {
      const base = new Map((baselineByPage[page] ?? []).map((r) => [r.id, r.value]));
      const diff: Record<string, string> = {};
      for (const r of list) {
        if (r.shared) continue;
        if (!base.has(r.id) || base.get(r.id) !== r.value) diff[r.id] = r.value;
      }
      if (Object.keys(diff).length > 0) edits[page] = diff;
    }
    return edits;
  },

  collectSharedEdits: (): SharedEdits => {
    const { pages, regionsByPage, baselineByPage } = get();
    return collectSharedEditsPure(pages, regionsByPage, baselineByPage);
  },

  saveProject: async (name) => {
    const { currentTemplate, currentProjectId, projects } = get();
    if (!currentTemplate) {
      set({ error: '没有打开的工作区，无法保存项目' });
      return null;
    }
    try {
      const existingName = projects.find((p) => p.id === currentProjectId)?.name;
      const finalName = (name ?? existingName ?? currentTemplate).trim() || currentTemplate;
      const edits = get().collectProjectEdits();
      const cssEdits = get().cssOverrides;
      const injections = get().collectInjections();
      const structureByPage = get().structureByPage;
      const sharedEdits = get().collectSharedEdits();
      const meta = await window.wt.saveProject({
        id: currentProjectId ?? undefined,
        name: finalName,
        templateName: currentTemplate,
        edits,
        cssEdits,
        injections,
        structureByPage,
        sharedEdits
      });
      // 已显式保存：自动草稿与脏标志清掉，已保存点推进到当前差异
      try {
        await window.wt.deleteAutosave({ templateName: currentTemplate });
      } catch {
        // 清理失败不影响保存结果
      }
      await window.wt.setDirty({ dirty: false }).catch(() => undefined);
      armAutosave(edits, cssEdits, injections, structureByPage, sharedEdits);
      set({ currentProjectId: meta.id, pendingAutosave: null, error: null });
      await get().fetchProjects();
      return meta.id;
    } catch (e) {
      set({ error: `保存项目失败: ${String(e)}` });
      return null;
    }
  },

  openProject: async (id) => {
    try {
      const project = await window.wt.readProject(id);
      // 源模板可能已被删除；以最新模板列表为准
      let templates = get().templates;
      if (!templates.some((t) => t.name === project.templateName)) {
        await get().fetchTemplates();
        templates = get().templates;
      }
      if (!templates.some((t) => t.name === project.templateName)) {
        set({ error: `项目「${project.name}」的源模板 ${project.templateName} 已不存在，无法打开` });
        return false;
      }
      // 重新解析源模板（基线为模板现状），完成后叠加草稿差异
      await get().openTemplate(project.templateName);
      // 区块结构（复制/排序/删除）先恢复并重解析，草稿 edits 随后按新 id 叠加
      if (project.structureByPage && Object.keys(project.structureByPage).length > 0) {
        const ok = await get().applyStructure(project.structureByPage);
        if (!ok) return false;
      }
      const projectShared = project.sharedEdits ?? {};
      const sharedIds = listSharedIds(Object.values(get().regionsByPage).flat());
      // 旧草稿可能把公共区值存在按页 edits 中，恢复时剔除，统一以 sharedEdits 为权威
      const projectEdits = stripSharedFromEdits(project.edits, sharedIds);
      set((state) => {
        // 公共区权威值先铺到所有出现页
        const withShared = applySharedEdits(state.regionsByPage, projectShared);
        const byPage: Record<string, Region[]> = {};
        for (const [page, list] of Object.entries(withShared)) {
          const vals = projectEdits[page];
          byPage[page] = vals
            ? list.map((r) => (Object.prototype.hasOwnProperty.call(vals, r.id) ? { ...r, value: vals[r.id] } : r))
            : list;
        }
        return {
          regionsByPage: byPage,
          regions: byPage[state.currentPage] ?? [],
          currentProjectId: project.id,
          // 草稿内容作为新的编辑起点，历史从空开始
          history: [],
          historyIndex: -1,
          selectedRid: null,
          rectsByRid: {},
          // 强制 iframe 重新加载，wt-ready 时重放的即为叠加草稿后的值
          iframeReloadToken: state.iframeReloadToken + 1
        };
      });
      // 显式打开项目：待恢复自动草稿作废，已保存点 = 项目内容（含 CSS 差异）
      try {
        await window.wt.deleteAutosave({ templateName: project.templateName });
      } catch {
        // 忽略
      }
      const projectCss = project.cssEdits ?? {};
      const projectInjections = project.injections ?? {};
      const projectStructure = project.structureByPage ?? {};
      await applyCssEdits(set, get, projectCss);
      applySiteInjections(set, get, projectInjections);
      armAutosave(projectEdits, projectCss, projectInjections, projectStructure, projectShared);
      set({ pendingAutosave: null });
      await window.wt.setDirty({ dirty: false }).catch(() => undefined);
      await get().fetchProjects();
      set({ error: null });
      return true;
    } catch (e) {
      set({ error: `打开项目失败: ${String(e)}` });
      return false;
    }
  },

  removeProject: async (id) => {
    try {
      const res = await window.wt.deleteProject({ id });
      // 后端返回失败（文件占用/权限）时不能假装成功：恢复列表并提示
      if (!res.ok) {
        set({ error: '删除草稿失败：文件可能被占用，请关闭后重试' });
        await get().fetchProjects();
        return;
      }
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProjectId: state.currentProjectId === id ? null : state.currentProjectId
      }));
    } catch (e) {
      set({ error: `删除项目失败: ${String(e)}` });
      await get().fetchProjects();
    }
  },

  exportTemplate: async (exportName, targetDir, zip) => {
    const { currentTemplate } = get();
    if (!currentTemplate) return null;
    // CSS 编辑只存在会话覆盖中：作为 cssEdits 传给主进程覆盖导出副本
    // 导出需要全部页面的最新编辑值（regions 只是当前页视图）
    const allRegions = Object.values(get().regionsByPage).flat();
    const cssEdits = get().cssOverrides;
    const injections = get().collectInjections();
    try {
      const res = await window.wt.exportTemplate({
        templateName: currentTemplate,
        regions: allRegions,
        cssEdits,
        injections,
        structureByPage: get().structureByPage,
        exportName,
        targetDir,
        zip
      });
      set({ lastExportPath: res.outputPath, error: null });
      return res;
    } catch (e) {
      set({ error: `导出失败: ${String(e)}` });
      return null;
    }
  },

  checkExportHealth: async () => {
    const { currentTemplate } = get();
    if (!currentTemplate) return null;
    try {
      return await window.wt.checkExportHealth({
        templateName: currentTemplate,
        regions: Object.values(get().regionsByPage).flat(),
        structureByPage: get().structureByPage
      });
    } catch (e) {
      set({ error: `健康检查失败: ${String(e)}` });
      return null;
    }
  },

  previewExternally: async () => {
    const { currentTemplate, currentPage } = get();
    if (!currentTemplate) return false;
    try {
      // 专用预览目录：与正式导出隔离，按工作区分目录，每次覆盖
      const { dir: previewRoot } = await window.wt.getPreviewDir();
      // 预览导出不应顶掉「已导出」正式路径指示
      const previousExportPath = get().lastExportPath;
      const res = await get().exportTemplate(currentTemplate, previewRoot, false);
      if (!res) return false;
      set({ lastExportPath: previousExportPath });
      // outputPath 形如 <previewRoot>/<safeName>/index.html，打开当前所在页
      const siteRoot = res.outputPath.replace(/[\\/][^\\/]*$/, '');
      const page = currentPage || 'index.html';
      const open = await window.wt.openPath({ target: `${siteRoot}/${page}` });
      if (!open.ok) {
        // 当前页文件异常时回退到首页
        const fallback = await window.wt.openPath({ target: res.outputPath });
        if (!fallback.ok) {
          set({ error: `无法在浏览器中打开：${open.error ?? fallback.error ?? '未知错误'}` });
          return false;
        }
      }
      return true;
    } catch (e) {
      set({ error: `外部预览失败: ${String(e)}` });
      return false;
    }
  },

  // ---------- 页面管理 ----------

  renamePage: async (page, newName) => {
    const templateName = get().currentTemplate;
    if (!templateName || page === 'index.html') return null;
    await get().flushCss();
    try {
      const res = await window.wt.managePage({
        templateName,
        action: 'rename',
        page,
        newName: newName.trim()
      });
      const newPage = res.pagePath;
      if (!newPage) return null;
      // 先替换顺序配置（保持原位置），再做内存键迁移与重新解析
      const wantedOrder = get().pages.map((p) => (p === page ? newPage : p));
      await window.wt.setPageOrder({ templateName, order: wantedOrder });
      remapPageKey(set, get, page, newPage);
      await reloadAfterStructure(set, get, templateName);
      set({ error: null });
      return newPage;
    } catch (e) {
      set({ error: `重命名页面失败: ${String(e)}` });
      return null;
    }
  },

  duplicatePage: async (page) => {
    const templateName = get().currentTemplate;
    if (!templateName) return null;
    try {
      const res = await window.wt.managePage({ templateName, action: 'duplicate', page });
      const newPage = res.pagePath;
      if (!newPage) return null;
      await reloadAfterStructure(set, get, templateName, { bumpReload: false });
      get().openTab(newPage);
      set({ error: null });
      return newPage;
    } catch (e) {
      set({ error: `复制页面失败: ${String(e)}` });
      return null;
    }
  },

  removePage: async (page) => {
    const templateName = get().currentTemplate;
    if (!templateName || page === 'index.html') return false;
    await get().flushCss();
    try {
      await window.wt.managePage({ templateName, action: 'delete', page });
      await reloadAfterStructure(set, get, templateName, {
        removedPage: page
      });
      // config.pageOrder 中残留的旧路径清掉
      await window.wt.setPageOrder({ templateName, order: get().pages }).catch(() => undefined);
      set({ error: null });
      return true;
    } catch (e) {
      set({ error: `删除页面失败: ${String(e)}` });
      return false;
    }
  },

  movePage: async (page, direction) => {
    const pages = [...get().pages];
    const from = pages.indexOf(page);
    if (from <= 0) return; // index.html 固定首位，不可移动
    const to = from + direction;
    if (to < 1 || to >= pages.length) return;
    [pages[from], pages[to]] = [pages[to], pages[from]];
    set({ pages });
    const templateName = get().currentTemplate;
    if (templateName) {
      try {
        await window.wt.setPageOrder({ templateName, order: pages });
      } catch (e) {
        set({ error: `保存页面顺序失败: ${String(e)}` });
      }
    }
  },

  savePageMeta: async (page, meta) => {
    const templateName = get().currentTemplate;
    if (!templateName) return false;
    try {
      const res = await window.wt.writePageMeta({ templateName, page, meta });
      const byPage = mergeParsedRegions(get().regionsByPage, res.regions);
      const baseline = mergeParsedRegions(get().baselineByPage, res.regions);
      set({
        pages: res.pages,
        regionsByPage: byPage,
        baselineByPage: baseline,
        regions: byPage[get().currentPage] ?? [],
        metaByPage: res.metaByPage ?? {},
        config: res.config
      });
      // 当前页 head 变了（title/favicon/lang）：重载预览并由 wt-ready 重放编辑
      if (page === get().currentPage) {
        set({ iframeReloadToken: get().iframeReloadToken + 1 });
      }
      set({ error: null });
      return true;
    } catch (e) {
      set({ error: `保存页面设置失败: ${String(e)}` });
      return false;
    }
  },

  applySiteHead: async (options) => {
    const templateName = get().currentTemplate;
    if (!templateName) return null;
    try {
      const res = await window.wt.applySiteHead({ templateName, ...options });
      const byPage = mergeParsedRegions(get().regionsByPage, res.regions);
      const baseline = mergeParsedRegions(get().baselineByPage, res.regions);
      set({
        pages: res.pages,
        regionsByPage: byPage,
        baselineByPage: baseline,
        regions: byPage[get().currentPage] ?? [],
        metaByPage: res.metaByPage ?? {},
        config: res.config
      });
      // 当前页 head 可能变化（favicon/title/OG）：重载预览并由 wt-ready 重放编辑
      if (res.changedPages > 0) {
        set({ iframeReloadToken: get().iframeReloadToken + 1 });
      }
      set({ error: null });
      return { pagesScanned: res.pagesScanned, changedPages: res.changedPages };
    } catch (e) {
      set({ error: `应用全站 head 设置失败: ${String(e)}` });
      return null;
    }
  },

  // ---------- 区块结构操作（仅 kind=block） ----------
  sectionOp: async (page, action, id) => {
    const templateName = get().currentTemplate;
    if (!templateName) return false;
    const prevByPage = get().regionsByPage;
    try {
      const res = await window.wt.sectionOp({ templateName, page, action, id });
      let byPage = mergeParsedRegions(prevByPage, res.regions);
      // 复制：用主进程返回的映射把源实例当前值（含内层 attr 标记）播种到克隆新 id
      if (res.cloned?.length) {
        const sourceList = prevByPage[page] ?? [];
        const seeds = new Map<string, string>();
        for (const m of res.cloned) {
          const src = sourceList.find((r) => r.id === m.sourceId);
          if (src) seeds.set(m.id, src.value);
        }
        if (seeds.size) {
          byPage = {
            ...byPage,
            [page]: (byPage[page] ?? []).map((r) =>
              seeds.has(r.id) ? { ...r, value: seeds.get(r.id) as string } : r
            )
          };
        }
      }
      const baseline = mergeParsedRegions(get().baselineByPage, res.regions);
      const table = { ...get().structureByPage };
      if (res.structure) table[page] = res.structure;
      else delete table[page];
      const currentPage = res.pages.includes(get().currentPage)
        ? get().currentPage
        : res.pages[0] || 'index.html';
      const selectedRid = get().selectedRid;
      const selectionAlive = selectedRid
        ? (byPage[currentPage] ?? []).some((r) => r.anchorRids.includes(selectedRid))
        : false;
      set({
        pages: res.pages,
        regionsByPage: byPage,
        baselineByPage: baseline,
        structureByPage: table,
        regions: byPage[currentPage] ?? [],
        currentPage,
        config: res.config,
        selectedRid: selectionAlive ? selectedRid : null,
        rectsByRid: {},
        iframeReloadToken: get().iframeReloadToken + 1
      });
      set({ error: null });
      return true;
    } catch (e) {
      set({ error: `区块操作失败: ${String(e)}` });
      return false;
    }
  },

  // 草稿恢复：把结构表下发主会话并重解析（region 编辑值由调用方随后叠加）
  applyStructure: async (structureByPage) => {
    const templateName = get().currentTemplate;
    if (!templateName) return false;
    try {
      const res = await window.wt.setStructure({ templateName, structureByPage });
      const byPage = mergeParsedRegions(get().regionsByPage, res.regions);
      const baseline = mergeParsedRegions(get().baselineByPage, res.regions);
      const currentPage = res.pages.includes(get().currentPage)
        ? get().currentPage
        : res.pages[0] || 'index.html';
      set({
        pages: res.pages,
        regionsByPage: byPage,
        baselineByPage: baseline,
        structureByPage: structuredClone(structureByPage),
        regions: byPage[currentPage] ?? [],
        currentPage,
        config: res.config,
        selectedRid: null,
        rectsByRid: {},
        iframeReloadToken: get().iframeReloadToken + 1
      });
      return true;
    } catch (e) {
      set({ error: `恢复区块结构失败: ${String(e)}` });
      return false;
    }
  },

  // ---------- 工作区管理 ----------

  renameWorkspace: async (newName) => {
    const oldName = get().currentTemplate;
    if (!oldName) return null;
    await get().flushCss();
    try {
      const res = await window.wt.manageTemplate({
        templateName: oldName,
        action: 'rename',
        newName: newName.trim()
      });
      const name = res.name;
      if (!name) return null;
      set({ currentTemplate: name });
      const parsed = await window.wt.parseTemplate(name);
      const byPage = mergeParsedRegions(get().regionsByPage, parsed.regions);
      const baseline = mergeParsedRegions(get().baselineByPage, parsed.regions);
      set({
        pages: parsed.pages,
        regionsByPage: byPage,
        baselineByPage: baseline,
        regions: byPage[get().currentPage] ?? [],
        metaByPage: parsed.metaByPage ?? {},
        config: parsed.config,
        pendingAutosave: get().pendingAutosave
          ? { ...get().pendingAutosave!, templateName: name }
          : null
      });
      try {
        const cssRes = await window.wt.listCssFiles({ templateName: name });
        set({ cssFiles: cssRes.files });
      } catch {
        set({ cssFiles: [] });
      }
      await get().fetchTemplates();
      set({ error: null });
      return name;
    } catch (e) {
      set({ error: `重命名工作区失败: ${String(e)}` });
      return null;
    }
  },

  duplicateWorkspace: async (newName) => {
    const templateName = get().currentTemplate;
    if (!templateName) return null;
    try {
      const res = await window.wt.manageTemplate({
        templateName,
        action: 'duplicate',
        newName: newName?.trim() || undefined
      });
      await get().fetchTemplates();
      set({ error: null });
      return res.name ?? null;
    } catch (e) {
      set({ error: `另存副本失败: ${String(e)}` });
      return null;
    }
  },

  deleteWorkspace: async () => {
    const templateName = get().currentTemplate;
    if (!templateName) return false;
    try {
      await window.wt.manageTemplate({ templateName, action: 'delete' });
      disarmAutosave();
      await window.wt.setDirty({ dirty: false }).catch(() => undefined);
      get().resetTemplate();
      await get().fetchTemplates();
      set({ activePanel: 'marketplace', lastPanel: 'marketplace', error: null });
      return true;
    } catch (e) {
      set({ error: `删除工作区失败: ${String(e)}` });
      return false;
    }
  },

  // ---------- 自动草稿恢复 ----------

  restoreAutosave: async () => {
    const templateName = get().currentTemplate;
    if (!templateName) return false;
    try {
      const { autosave } = await window.wt.getAutosave({ templateName });
      if (!autosave) {
        armAutosave('empty');
        set({ pendingAutosave: null });
        return true;
      }
      const rawEdits = autosave.edits;
      const autosaveCss = autosave.cssEdits ?? {};
      const autosaveInjections = autosave.injections ?? {};
      const autosaveStructure = autosave.structureByPage ?? {};
      const autosaveShared = autosave.sharedEdits ?? {};
      // 先恢复区块结构（重解析），再把草稿值按新结构下的 region id 叠加
      if (Object.keys(autosaveStructure).length > 0) {
        const ok = await get().applyStructure(autosaveStructure);
        if (!ok) return false;
      }
      const sharedIds = listSharedIds(Object.values(get().regionsByPage).flat());
      // 旧草稿兼容：公共区值从按页 edits 中剔除，统一以 sharedEdits 为权威
      const edits = stripSharedFromEdits(rawEdits, sharedIds);
      set((state) => {
        // 公共区权威值先铺到所有出现页
        const withShared = applySharedEdits(state.regionsByPage, autosaveShared);
        const byPage: Record<string, Region[]> = {};
        for (const [page, list] of Object.entries(withShared)) {
          const vals = edits[page];
          byPage[page] = vals
            ? list.map((r) =>
                Object.prototype.hasOwnProperty.call(vals, r.id) ? { ...r, value: vals[r.id] } : r
              )
            : list;
        }
        return {
          regionsByPage: byPage,
          regions: byPage[state.currentPage] ?? [],
          pendingAutosave: null,
          history: [],
          historyIndex: -1,
          selectedRid: null,
          rectsByRid: {},
          iframeReloadToken: state.iframeReloadToken + 1
        };
      });
      // CSS 差异同样恢复（iframe 重载后 wt-ready 还会按 store 再重放一次）
      await applyCssEdits(set, get, autosaveCss);
      applySiteInjections(set, get, autosaveInjections);
      // 恢复内容本身即「上次未保存点」：已保存点取它，之后的新修改才再次置脏
      armAutosave(edits, autosaveCss, autosaveInjections, autosaveStructure, autosaveShared);
      await window.wt.setDirty({ dirty: true }).catch(() => undefined);
      return true;
    } catch (e) {
      set({ error: `恢复自动草稿失败: ${String(e)}` });
      return false;
    }
  },

  discardAutosave: async () => {
    const templateName = get().currentTemplate;
    if (templateName) {
      try {
        await window.wt.deleteAutosave({ templateName });
      } catch {
        // 忽略
      }
    }
    armAutosave('empty');
    set({ pendingAutosave: null });
    await window.wt.setDirty({ dirty: false }).catch(() => undefined);
  },

  setCssFiles: (cssFiles) => set({ cssFiles }),
  setCssCurrentFile: (cssCurrentFile) => set({ cssCurrentFile }),
  setCssBlocks: (cssBlocks) => set({ cssBlocks }),

  // 读取并解析 CSS 文件；成功后设为当前文件，内容取会话覆盖（无则磁盘基线）
  loadCssFile: async (path) => {
    const { currentTemplate } = get();
    if (!currentTemplate) return;
    try {
      const res = await window.wt.readCssFile({ templateName: currentTemplate, path });
      const baselineText = serializeCss(res.blocks);
      set((state) => ({
        cssCurrentFile: path,
        cssBlocks: state.cssOverrides[path] ? parseCss(state.cssOverrides[path]) : res.blocks,
        cssBaseline:
          state.cssBaseline[path] === undefined
            ? { ...state.cssBaseline, [path]: baselineText }
            : state.cssBaseline
      }));
      // 始终注入全部覆盖（其他文件的修改不能因切换文件而从预览消失）
      get().iframeApi?.postMessage({
        type: 'wt-css-update',
        cssText: overrideCssText(get().cssFiles, get().cssOverrides)
      });
    } catch (e) {
      set({ error: `读取 CSS 失败: ${String(e)}` });
    }
  },

  // 放弃当前文件的修改：删掉覆盖键，重新读盘回到基线，再全量重注入
  restoreCssFile: async () => {
    const { currentTemplate, cssCurrentFile } = get();
    if (!currentTemplate || !cssCurrentFile) return;
    try {
      const res = await window.wt.readCssFile({
        templateName: currentTemplate,
        path: cssCurrentFile
      });
      const baselineText = serializeCss(res.blocks);
      set((state) => {
        const cssOverrides = { ...state.cssOverrides };
        delete cssOverrides[cssCurrentFile];
        return {
          cssBlocks: res.blocks,
          cssOverrides,
          cssBaseline: { ...state.cssBaseline, [cssCurrentFile]: baselineText }
        };
      });
      get().iframeApi?.postMessage({
        type: 'wt-css-update',
        cssText: overrideCssText(get().cssFiles, get().cssOverrides)
      });
      scheduleAutosave();
    } catch (e) {
      set({ error: `恢复 CSS 失败: ${String(e)}` });
    }
  },

  // 「保存到草稿」= 立即把当前内容+CSS 差异写入自动草稿（模板磁盘始终不变）
  saveCssFile: async () => {
    await persistAutosave();
  },

  // CSS 编辑实时提交到 cssOverrides，无需统一 flush；保留空实现兼容旧调用点
  flushCss: async () => {},

  // 修改某个 block：同步覆盖表与实时预览，随后防抖写自动草稿
  updateCssBlock: (index, block, filePath) => {
    const state = get();
    const target = filePath ?? state.cssCurrentFile;
    if (!target || target !== state.cssCurrentFile) return;
    const next = [...state.cssBlocks];
    next[index] = block;
    commitCssBlocks(set, get, next);
  },

  addCssBlock: (block) => {
    commitCssBlocks(set, get, [...get().cssBlocks, block]);
  },

  removeCssBlock: (index) => {
    const next = [...get().cssBlocks];
    next.splice(index, 1);
    commitCssBlocks(set, get, next);
  },

  // ---------- 主题变量（--var）聚合编辑 ----------

  loadThemePanel: async () => {
    const state = get();
    const templateName = state.currentTemplate;
    if (!templateName) return;
    set({ themeLoading: true });
    try {
      const inputs: Record<string, ThemeFileInput> = {};
      const missingBaseline: Record<string, string> = {};
      await Promise.all(
        state.cssFiles.map(async (file) => {
          const res = await window.wt.readCssFile({ templateName, path: file });
          const baselineText = serializeCss(res.blocks);
          // 有效块：有会话覆盖用覆盖，否则用磁盘解析
          const blocks = state.cssOverrides[file] ? parseCss(state.cssOverrides[file]) : res.blocks;
          themeBlocksCache[file] = blocks;
          inputs[file] = { blocks, baselineBlocks: res.blocks };
          // 与 loadCssFile 一致：补齐基线，供「改回默认」时剔除覆盖键
          if (state.cssBaseline[file] === undefined) missingBaseline[file] = baselineText;
        })
      );
      if (Object.keys(missingBaseline).length > 0) {
        set((s) => ({ cssBaseline: { ...s.cssBaseline, ...missingBaseline } }));
      }
      set({ themeVars: collectThemeVariables(inputs), themeLoading: false });
    } catch (e) {
      set({ themeLoading: false, error: `加载主题变量失败: ${String(e)}` });
    }
  },

  updateThemeVariable: (file, blockIndex, declIndex, value) => {
    const current = themeBlocksCache[file];
    if (!current) return;
    const next = patchThemeVariable(current, blockIndex, declIndex, value);
    if (next === current) return;
    commitThemeFile(set, get, file, next);
    set((s) => ({
      themeVars: s.themeVars.map((v) =>
        v.file === file && v.blockIndex === blockIndex && v.declIndex === declIndex
          ? { ...v, value }
          : v
      )
    }));
  },

  resetThemeVariable: (file, blockIndex, declIndex) => {
    const target = get().themeVars.find(
      (v) => v.file === file && v.blockIndex === blockIndex && v.declIndex === declIndex
    );
    // 会话中新增的变量没有基线可回退，不在此处理
    if (!target || !target.inBaseline) return;
    get().updateThemeVariable(file, blockIndex, declIndex, target.baselineValue);
  },

  resetAllThemeVariables: () => {
    const dirty = get().themeVars.filter((v) => v.inBaseline && v.value !== v.baselineValue);
    if (dirty.length === 0) return;
    // 按文件折叠补丁（只改值不动结构，下标稳定），每文件只提交一次
    const files = new Map<string, ThemeVariable[]>();
    for (const v of dirty) {
      const list = files.get(v.file);
      if (list) list.push(v);
      else files.set(v.file, [v]);
    }
    for (const [file, list] of files) {
      let blocks = themeBlocksCache[file];
      if (!blocks) continue;
      for (const v of list) {
        blocks = patchThemeVariable(blocks, v.blockIndex, v.declIndex, v.baselineValue);
      }
      commitThemeFile(set, get, file, blocks);
    }
    set((s) => ({
      themeVars: s.themeVars.map((v) =>
        v.inBaseline && v.value !== v.baselineValue ? { ...v, value: v.baselineValue } : v
      )
    }));
  },

  collectInjections: () => {
    const { headInjection, bodyInjection } = get();
    const out: SiteInjections = {};
    const head = headInjection.trim();
    const body = bodyInjection.trim();
    if (head) out.head = head;
    if (body) out.body = body;
    return out;
  },

  setSiteInjections: (inj) => {
    const head = inj.head ?? '';
    const body = inj.body ?? '';
    set({ headInjection: head, bodyInjection: body });
    // 立即在预览中生效：iframe 侧会重建注入节点，script 以可执行方式插入
    get().iframeApi?.postMessage({ type: 'wt-inject-update', head, body });
    scheduleAutosave();
  },

  scanExternalImages: async () => {
    const templateName = get().currentTemplate;
    if (!templateName) return null;
    try {
      const res = await window.wt.scanExternalImages({ templateName });
      set({ error: null });
      return res.images;
    } catch (e) {
      set({ error: `扫描外链图片失败: ${String(e)}` });
      return null;
    }
  },

  localizeImages: async (urls) => {
    const templateName = get().currentTemplate;
    if (!templateName || get().imageLocalizing) return null;
    set({ imageLocalizing: true });
    try {
      const res: LocalizeImagesResult = await window.wt.localizeImages({ templateName, urls });

      // 1. 磁盘 HTML 已重写：会话值合并后，把 region 值中残留的同一批外链替换为本地引用
      const byPage = mergeParsedRegions(get().regionsByPage, res.regions);
      // 基线必须以新磁盘解析为准（不能 merge 旧基线，否则图片区会被误判为有改动）
      const newBaseline = groupByPage(res.regions);
      if (res.localized.length > 0) {
        const pairsByPage = new Map<string, { url: string; localRef: string }[]>();
        for (const page of Object.keys(byPage)) {
          pairsByPage.set(
            page,
            res.localized.map((item) => ({
              url: item.url,
              localRef: relativeAssetRef(page, item.sitePath)
            }))
          );
        }
        for (const [page, list] of Object.entries(byPage)) {
          const pairs = pairsByPage.get(page) ?? [];
          for (const region of list) {
            // 廉价预判，避免对大量 region 跑替换
            if (!/https?:\/\/|\/\//.test(region.value)) continue;
            const next = rewriteExternalRefs(region.value, pairs);
            if (next !== region.value) region.value = next;
          }
        }
      }

      // 2. CSS 会话覆盖调和：改动文件的覆盖全文同步替换，与新基线比较决定保留/剔除
      const cssOverrides = { ...get().cssOverrides };
      const cssBaseline = { ...get().cssBaseline };
      let cssBlocks = get().cssBlocks;
      let overrideChanged = false;
      for (const file of res.changedCss) {
        let newBaselineText = '';
        try {
          const r = await window.wt.readCssFile({ templateName, path: file });
          newBaselineText = serializeCss(r.blocks);
          cssBaseline[file] = newBaselineText;
        } catch {
          // CSS 读取失败（文件消失）时放弃基线刷新，仅尝试调和覆盖
        }
        const current = cssOverrides[file];
        if (current !== undefined) {
          const pairs = res.localized.map((item) => ({
            url: item.url,
            localRef: relativeAssetRef(file, item.sitePath)
          }));
          const next = serializeCss(parseCss(rewriteExternalRefs(current, pairs)));
          if (newBaselineText && next === newBaselineText) delete cssOverrides[file];
          else cssOverrides[file] = next;
          overrideChanged = true;
        }
        // 主题块缓存/样式面板视图同步到生效文本
        const effective = cssOverrides[file] ?? newBaselineText;
        if (effective) {
          const blocks = parseCss(effective);
          if (themeBlocksCache[file]) themeBlocksCache[file] = blocks;
          if (get().cssCurrentFile === file) cssBlocks = blocks;
        } else {
          delete themeBlocksCache[file];
        }
      }

      set({
        pages: res.pages,
        regionsByPage: byPage,
        baselineByPage: newBaseline,
        regions: byPage[get().currentPage] ?? [],
        metaByPage: res.metaByPage ?? {},
        config: res.config,
        cssOverrides,
        cssBaseline,
        cssBlocks
      });

      // 3. 刷新预览：HTML 变了走整页重载（wt-ready 重放编辑）；CSS 覆盖有变化重新注入
      if (res.changedHtml.length > 0) {
        set({ iframeReloadToken: get().iframeReloadToken + 1 });
      } else if (overrideChanged) {
        get().iframeApi?.postMessage({
          type: 'wt-css-update',
          cssText: overrideCssText(get().cssFiles, cssOverrides)
        });
      }
      scheduleAutosave();
      set({ error: null });
      return res;
    } catch (e) {
      set({ error: `外链图片本地化失败: ${String(e)}` });
      return null;
    } finally {
      set({ imageLocalizing: false });
    }
  },

  resetTemplate: () => {
    disarmAutosave();
    clearThemeBlocksCache();
    void window.wt.setDirty({ dirty: false }).catch(() => undefined);
    set({
      currentTemplate: null,
      pages: [],
      currentPage: 'index.html',
      regions: [],
      regionsByPage: {},
      baselineByPage: {},
      structureByPage: {},
      metaByPage: {},
      pendingAutosave: null,
      config: null,
      selectedRid: null,
      rectsByRid: {},
      openTabs: [],
      activeTab: null,
      dirtyTabs: {},
      history: [],
      historyIndex: -1,
      navHistory: [],
      navIndex: -1,
      cssFiles: [],
      cssCurrentFile: null,
      cssBlocks: [],
      cssBaseline: {},
      cssOverrides: {},
      themeVars: [],
      themeLoading: false,
      headInjection: '',
      bodyInjection: '',
      imageLocalizing: false
    });
  },

  goHome: async () => {
    // 内容编辑与 CSS 覆盖写入自动草稿，确保回主页/重开不丢编辑
    try {
      await persistAutosave();
    } catch {
      // 落盘失败不阻塞回主页
    }
    get().resetTemplate();
  }
}));

// 监听编辑变化（内容 / CSS）→ 安排自动草稿（armed 后生效）
useTemplateStore.subscribe((state, prev) => {
  if (state.regionsByPage !== prev.regionsByPage) scheduleAutosave();
  if (state.cssOverrides !== prev.cssOverrides) scheduleAutosave();
  if (state.structureByPage !== prev.structureByPage) scheduleAutosave();
});

// 主进程关窗拦截：收到「请保存」→ CSS + 内容草稿落盘 → 放行退出
if (typeof window !== 'undefined' && window.wt?.onQuitSave) {
  window.wt.onQuitSave(() => {
    void flushAllForQuit().finally(() => {
      void window.wt.confirmQuit();
    });
  });
}

// 开发态暴露 store，供 CDP 冒烟/调试使用（生产构建会被静态消除）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __wtStore?: typeof useTemplateStore }).__wtStore =
    useTemplateStore;
}
