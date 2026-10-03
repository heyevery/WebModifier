// src/components/TopBar/TopBar.tsx
// 顶栏：标题、当前模板、页面切换器（多页网站）、导出按钮

import { Suspense, lazy, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import { onIntent } from '@/lib/intents';

// 对话框按打开时机懒加载：不进入首屏包，首次唤起时才拉取分块（之后保持挂载以保留退出动画）
function namedLazy<M extends Record<string, unknown>, K extends keyof M>(
  loader: () => Promise<M>,
  key: K
): ComponentType<{ open: boolean; onClose: () => void }> {
  return lazy(async () => ({ default: (await loader())[key] as ComponentType }));
}

const ExportDialog = namedLazy(() => import('@/components/ExportDialog/ExportDialog'), 'ExportDialog');
const PageSettingsDialog = namedLazy(
  () => import('@/components/PageSettings/PageSettingsDialog'),
  'PageSettingsDialog'
);
const SiteCodeDialog = namedLazy(
  () => import('@/components/SiteCodeDialog/SiteCodeDialog'),
  'SiteCodeDialog'
);
const FindReplaceDialog = namedLazy(
  () => import('@/components/FindReplace/FindReplaceDialog'),
  'FindReplaceDialog'
);
const SiteHeadDialog = namedLazy(
  () => import('@/components/SiteHead/SiteHeadDialog'),
  'SiteHeadDialog'
);
const LocalizeImagesDialog = namedLazy(
  () => import('@/components/LocalizeImages/LocalizeImagesDialog'),
  'LocalizeImagesDialog'
);

/** 首次 open 时才挂载内部懒组件，挂载后常驻（避免关闭时退出动画被切断） */
function LazyDialog({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}

/** 自绘页面切换下拉（原生 select 深色样式差且不便于自动化操作） */
function PageSwitcher() {
  const pages = useTemplateStore((s) => s.pages);
  const currentPage = useTemplateStore((s) => s.currentPage);
  const setCurrentPage = useTemplateStore((s) => s.setCurrentPage);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  if (pages.length <= 1) return null;

  return (
    <div className="flex items-center gap-1" ref={rootRef}>
      <div className="text-wt-muted text-[12px]">/</div>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 h-6 bg-wt-bg border border-wt-border rounded-sm px-2
                     text-[11px] text-wt-text font-mono hover:border-wt-primary/50 transition-colors"
          title="切换页面"
        >
          <span className="truncate max-w-[140px]">{currentPage}</span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-wt-muted text-[9px]">
            ▼
          </motion.span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className="absolute top-full left-0 mt-1 z-40 min-w-[180px] max-h-64 overflow-y-auto
                         bg-wt-surface border border-wt-border rounded-md shadow-wt-lg py-1"
            >
              {pages.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setCurrentPage(p);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors ${
                    p === currentPage
                      ? 'bg-wt-primary/15 text-wt-primary'
                      : 'text-wt-muted hover:bg-wt-surface-2 hover:text-wt-text'
                  }`}
                >
                  {p}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function TopBar() {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const regions = useTemplateStore((s) => s.regions);
  const lastExportPath = useTemplateStore((s) => s.lastExportPath);
  const error = useTemplateStore((s) => s.error);
  const navigateBack = useTemplateStore((s) => s.navigateBack);
  const navigateForward = useTemplateStore((s) => s.navigateForward);
  const canNavigateBack = useTemplateStore((s) => s.canNavigateBack);
  const canNavigateForward = useTemplateStore((s) => s.canNavigateForward);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const restoreTemplate = useTemplateStore((s) => s.restoreTemplate);
  const templates = useTemplateStore((s) => s.templates);
  const saveProject = useTemplateStore((s) => s.saveProject);
  const previewExternally = useTemplateStore((s) => s.previewExternally);
  const currentProjectId = useTemplateStore((s) => s.currentProjectId);
  const projects = useTemplateStore((s) => s.projects);
  const [dialogOpen, setDialogOpen] = useState(false);
  // 恢复模板确认对话框
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoredOk, setRestoredOk] = useState(false);
  // 保存项目
  const [saveOpen, setSaveOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  // 页面设置（title/description/favicon/lang）
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  // 全站自定义代码（head/body 注入：统计、客服等）
  const [siteCodeOpen, setSiteCodeOpen] = useState(false);
  // 跨页面全局查找替换
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  // 全站 head 默认（favicon/标题/描述/OG）
  const [siteHeadOpen, setSiteHeadOpen] = useState(false);
  // 外链图片本地化（下载到 assets/external 并改写引用）
  const [localizeImagesOpen, setLocalizeImagesOpen] = useState(false);
  // 外部浏览器预览（导出临时副本后打开，期间按钮转圈）
  const [previewing, setPreviewing] = useState(false);

  async function handleExternalPreview(): Promise<void> {
    if (!currentTemplate || previewing) return;
    setPreviewing(true);
    try {
      await previewExternally();
    } finally {
      setPreviewing(false);
    }
  }

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  function flashSaved(): void {
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2000);
  }

  async function handleSaveClick(): Promise<void> {
    if (!currentTemplate || saving) return;
    // 已在草稿中：直接覆盖保存；否则先询问项目名
    if (currentProjectId) {
      setSaving(true);
      try {
        const id = await saveProject();
        if (id) flashSaved();
      } finally {
        setSaving(false);
      }
    } else {
      setProjectName(currentTemplate);
      setSaveOpen(true);
    }
  }

  async function confirmSave(): Promise<void> {
    if (saving || !projectName.trim()) return;
    setSaving(true);
    try {
      const id = await saveProject(projectName);
      if (id) {
        setSaveOpen(false);
        flashSaved();
      }
    } finally {
      setSaving(false);
    }
  }

  // Ctrl/Cmd+S 保存项目草稿（阻止浏览器保存网页）
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSaveClick();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 命令面板意图：打开各对话框（无依赖数组，保持 handleSaveClick 闭包为最新）
  useEffect(() =>
    onIntent((id) => {
      if (id === 'export') setDialogOpen(true);
      else if (id === 'page-settings') setPageSettingsOpen(true);
      else if (id === 'site-code') setSiteCodeOpen(true);
      else if (id === 'find-replace') setFindReplaceOpen(true);
      else if (id === 'site-head') setSiteHeadOpen(true);
      else if (id === 'external-preview') void handleExternalPreview();
      else if (id === 'restore-template') setRestoreOpen(true);
      else if (id === 'save-project') void handleSaveClick();
    })
  );

  async function confirmRestore() {
    if (restoring) return;
    setRestoring(true);
    try {
      const ok = await restoreTemplate();
      if (ok) {
        await fetchTemplates();
        setRestoredOk(true);
        setTimeout(() => setRestoredOk(false), 2500);
      }
      setRestoreOpen(false);
    } finally {
      setRestoring(false);
    }
  }

  // 当前模板是否可恢复（有原件快照）
  const currentMeta = templates.find((t) => t.name === currentTemplate);
  const canRestore = !!currentTemplate && currentMeta?.hasSnapshot !== false;

  return (
    <header className="h-10 bg-wt-titlebar border-b border-wt-border flex items-center px-2 gap-1.5 flex-shrink-0">
      <div className="flex items-center gap-1.5">
        <motion.div
          initial={{ rotate: -180, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-5 h-5 rounded-sm bg-wt-accent"
        />
        <span className="font-semibold text-wt-text text-[13px]">Web Modifier</span>
      </div>

      {/* 导航前进/后退 */}
      <div className="flex items-center gap-0 ml-0.5">
        <button
          onClick={navigateBack}
          disabled={!canNavigateBack()}
          className="w-6 h-6 flex items-center justify-center rounded-sm text-[13px] text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
          title="后退 (Alt+←)"
        >
          ←
        </button>
        <button
          onClick={navigateForward}
          disabled={!canNavigateForward()}
          className="w-6 h-6 flex items-center justify-center rounded-sm text-[13px] text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
          title="前进 (Alt+→)"
        >
          →
        </button>
      </div>

      <div className="text-wt-muted text-[12px]">/</div>
      <div className="text-wt-muted text-[12px] font-mono">
        {currentTemplate || '未选择模板'}
      </div>

      {/* 当前打开的项目草稿 */}
      {currentProject && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-wt-accent/15 text-wt-accent border border-wt-accent/30"
          title={`项目草稿「${currentProject.name}」：编辑保存在草稿中，不影响模板`}
        >
          📦 {currentProject.name}
        </span>
      )}

      {/* 多页网站：页面切换器（单页时自动隐藏） */}
      <PageSwitcher />

      {/* 全局查找替换（跨所有页面改公司名/电话等） */}
      <button
        onClick={() => setFindReplaceOpen(true)}
        disabled={!currentTemplate}
        className="w-6 h-6 flex items-center justify-center rounded-sm text-[12px] text-wt-muted
                   hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
        title="全局查找替换（在所有页面的可编辑文字中查找替换）"
      >
        ⌕
      </button>
      <LazyDialog open={findReplaceOpen}>
        <FindReplaceDialog open={findReplaceOpen} onClose={() => setFindReplaceOpen(false)} />
      </LazyDialog>

      {/* 全站 head 默认：favicon / 标题模式 / 描述 / Open Graph */}
      <button
        onClick={() => setSiteHeadOpen(true)}
        disabled={!currentTemplate}
        className="w-6 h-6 flex items-center justify-center rounded-sm text-[12px] font-mono font-semibold text-wt-muted
                   hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
        title="全站 head 设置（统一 favicon、标题后缀、描述、社交分享标签）"
      >
        H
      </button>
      <LazyDialog open={siteHeadOpen}>
        <SiteHeadDialog open={siteHeadOpen} onClose={() => setSiteHeadOpen(false)} />
      </LazyDialog>

      {/* 外链图片本地化：下载 http(s) 图片到工作区并改写为本地引用 */}
      <button
        onClick={() => setLocalizeImagesOpen(true)}
        disabled={!currentTemplate}
        className="w-6 h-6 flex items-center justify-center rounded-sm text-wt-muted
                   hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
        title="外链图片本地化（下载网络图片到 assets/external，导出站点可离线打开）"
      >
        <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="M21 16l-5-5-9 9" />
        </svg>
      </button>
      <LazyDialog open={localizeImagesOpen}>
        <LocalizeImagesDialog open={localizeImagesOpen} onClose={() => setLocalizeImagesOpen(false)} />
      </LazyDialog>

      {/* 当前页设置：title / description / favicon / lang */}
      <button
        onClick={() => setPageSettingsOpen(true)}
        disabled={!currentTemplate}
        className="w-6 h-6 flex items-center justify-center rounded-sm text-[13px] text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
        title="页面设置（标题、描述、网站图标、语言）"
      >
        ⚙
      </button>
      <LazyDialog open={pageSettingsOpen}>
        <PageSettingsDialog open={pageSettingsOpen} onClose={() => setPageSettingsOpen(false)} />
      </LazyDialog>

      {/* 全站自定义代码：head/body 注入（统计、客服、站长验证） */}
      <button
        onClick={() => setSiteCodeOpen(true)}
        disabled={!currentTemplate}
        className="w-6 h-6 flex items-center justify-center rounded-sm text-[11px] font-mono font-semibold text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
        title="自定义代码（统计、客服脚本，全站生效）"
      >
        &lt;/&gt;
      </button>
      <LazyDialog open={siteCodeOpen}>
        <SiteCodeDialog open={siteCodeOpen} onClose={() => setSiteCodeOpen(false)} />
      </LazyDialog>

      {/* 在系统默认浏览器中打开当前编辑态（临时导出，含全部修改/CSS/注入） */}
      <button
        onClick={() => void handleExternalPreview()}
        disabled={!currentTemplate || previewing}
        className="h-6 px-2 flex items-center justify-center gap-1 rounded-sm text-[11px] text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 disabled:opacity-30 transition-colors"
        title="在外部浏览器中预览（生成含当前全部修改的临时副本）"
      >
        {previewing ? '打开中…' : '↗ 浏览器预览'}
      </button>

      <div className="flex-1" />

      {/* 保存项目草稿 */}
      {savedOk && (
        <motion.span
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-[11px] text-wt-success"
        >
          项目已保存
        </motion.span>
      )}
      <button
        onClick={handleSaveClick}
        disabled={!currentTemplate || regions.length === 0 || saving}
        className="h-6 px-2 text-[11px] rounded-sm bg-wt-surface-2 text-wt-muted hover:text-wt-text hover:bg-wt-input transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="把当前所有页面的修改保存为项目草稿（不改动模板）；Ctrl/Cmd+S"
      >
        {saving ? '保存中…' : currentProjectId ? '💾 保存项目' : '💾 保存为项目'}
      </button>

      {/* 恢复模板 */}
      {restoredOk && (
        <motion.span
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-[11px] text-wt-success"
        >
          已恢复原状
        </motion.span>
      )}
      <button
        onClick={() => setRestoreOpen(true)}
        disabled={!canRestore}
        className="h-6 px-2 text-[11px] rounded-sm bg-wt-surface-2 text-wt-muted hover:text-wt-text hover:bg-wt-input transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="恢复到首次打开时的原始状态（含已删除的组件）"
      >
        ↺ 恢复模板
      </button>

      {error && (
        <span className="text-[11px] text-wt-danger" title={error}>
          出错了
        </span>
      )}
      {lastExportPath && !error && (
        <motion.button
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-[11px] text-wt-success truncate max-w-[300px] hover:underline"
          title={`${lastExportPath}\n（点击打开导出目录）`}
          onClick={() => {
            void window.wt
              .openPath({ target: lastExportPath.replace(/[\\/][^\\/]*$/, '') })
              .catch(() => undefined);
          }}
        >
          已导出: {lastExportPath}
        </motion.button>
      )}
      <button
        className="h-6 px-2.5 text-[12px] font-medium bg-wt-primary hover:bg-wt-primary-hover text-white rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => setDialogOpen(true)}
        disabled={!currentTemplate || regions.length === 0}
      >
        导出
      </button>

      <LazyDialog open={dialogOpen}>
        <ExportDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      </LazyDialog>

      {/* 保存为项目草稿：命名 */}
      <AnimatePresence>
        {saveOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
            onClick={() => !saving && setSaveOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-[380px] bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-wt-text mb-1">保存为项目</div>
              <div className="text-xs text-wt-muted leading-relaxed mb-3">
                将当前所有页面的修改存入「我的项目」草稿，
                <span className="text-wt-text">模板本身不会被改动</span>。
                之后可从左侧「我的项目」继续编辑，也可随时导出为静态网站。
              </div>
              <label className="block mb-4">
                <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1">
                  项目名称（支持中文；重名自动加后缀）
                </div>
                <input
                  autoFocus
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmSave();
                  }}
                  placeholder="例如：我的官网改版"
                  spellCheck={false}
                  className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setSaveOpen(false)}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmSave}
                  disabled={saving || !projectName.trim()}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 恢复模板确认对话框 */}
      <AnimatePresence>
        {restoreOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
            onClick={() => !restoring && setRestoreOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-[380px] bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-wt-text mb-2">恢复模板到原状？</div>
              <div className="text-xs text-wt-muted leading-relaxed">
                将把 <span className="text-wt-text font-mono">{currentTemplate}</span> 回滚到首次打开时的原始状态，
                包括已删除的组件、已修改的文字和样式。<span className="text-wt-warning">所有未导出的修改将丢失。</span>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setRestoreOpen(false)}
                  disabled={restoring}
                  className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmRestore}
                  disabled={restoring}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-md bg-wt-warning hover:bg-wt-warning/80
                             text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {restoring ? '恢复中…' : '恢复原状'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
