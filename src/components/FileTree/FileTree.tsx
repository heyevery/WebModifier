// src/components/FileTree/FileTree.tsx
// 资源管理器：树形展示当前模板的所有文件，点击 HTML 文件打开

import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import type { FileTreeNode } from '@shared/types/ipc';
import type { TemplateMeta } from '@shared/types/region';
import { onIntent } from '@/lib/intents';

// 模板来源徽标（市场复制/外部导入/自定义）
function sourceBadge(source?: string): { label: string; cls: string } | null {
  switch (source) {
    case 'market':
      return { label: '市场', cls: 'bg-wt-primary/20 text-wt-primary' };
    case 'import':
      return { label: '导入', cls: 'bg-wt-warning/20 text-wt-warning' };
    case 'custom':
      return { label: '自定义', cls: 'bg-wt-surface-2 text-wt-muted' };
    default:
      return null;
  }
}

// 根据扩展名返回图标颜色
function fileIcon(name: string): { color: string; label: string } {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (/html?/.test(ext)) return { color: '#e34c26', label: '<>' };
  if (ext === 'css') return { color: '#2965f1', label: '#' };
  if (ext === 'js' || ext === 'mjs') return { color: '#f7df1e', label: 'JS' };
  if (ext === 'json') return { color: '#cbcb41', label: '{}' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'].includes(ext)) return { color: '#a78bfa', label: 'IMG' };
  if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return { color: '#10b981', label: 'F' };
  return { color: 'rgb(var(--wt-muted-rgb))', label: '•' };
}

// 「导入为新页面」对话框中的分组来源列表（空组不渲染）
function SourceListGroup({
  title,
  items,
  active,
  onPick
}: {
  title: string;
  items: TemplateMeta[];
  active: string | null;
  onPick: (name: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="sticky top-0 z-10 px-2.5 pt-2 pb-1 text-[9px] uppercase tracking-[0.12em] text-wt-muted bg-wt-bg/95 backdrop-blur-sm">
        {title}
      </div>
      {items.map((t) => {
        const badge = sourceBadge(t.source);
        const isActive = active === t.name;
        return (
          <button
            key={t.name}
            onClick={() => onPick(t.name)}
            className={`w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs border-b border-wt-border/60 last:border-b-0 transition-colors ${
              isActive ? 'bg-wt-primary/15' : 'hover:bg-wt-surface-2'
            }`}
          >
            <span
              className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center ${
                isActive ? 'border-wt-primary' : 'border-wt-border'
              }`}
            >
              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-wt-primary" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block truncate font-mono text-wt-text">{t.name}</span>
              <span className="block text-[10px] text-wt-muted">{t.pageCount} 个页面</span>
            </span>
            {badge && (
              <span className={`text-[8px] px-1 rounded flex-shrink-0 ${badge.cls}`}>
                {badge.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  onPageMenu
}: {
  node: FileTreeNode;
  depth: number;
  onPageMenu: (e: ReactMouseEvent, page: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1); // 默认展开第一层
  const openTab = useTemplateStore((s) => s.openTab);
  const currentPage = useTemplateStore((s) => s.currentPage);
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const pages = useTemplateStore((s) => s.pages);

  const isHtml = /\.html?$/i.test(node.name);
  const isActive = isHtml && node.path === currentPage;
  // 只有被识别为「网站页面」的 HTML 才提供页面管理菜单（assets 里的零散 HTML 不处理）
  const isManagedPage = isHtml && pages.includes(node.path);

  async function handleClick() {
    if (node.isDirectory) {
      setOpen((v) => !v);
      return;
    }
    if (isHtml && currentTemplate) {
      openTab(node.path);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={(e) => {
          if (isManagedPage) {
            e.preventDefault();
            onPageMenu(e, node.path);
          }
        }}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-xs transition-colors ${
          isActive
            ? 'bg-wt-primary/15 text-wt-text'
            : 'text-wt-muted hover:bg-wt-surface-2 hover:text-wt-text'
        } ${isManagedPage ? 'context-menu-target' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={isManagedPage ? '右键可重命名 / 复制 / 删除 / 排序' : undefined}
      >
        {node.isDirectory ? (
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            className="text-[10px] text-wt-muted flex-shrink-0"
          >
            ▶
          </motion.span>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {node.isDirectory ? (
          <span className="text-wt-accent text-[11px] flex-shrink-0">📁</span>
        ) : (
          <span
            className="text-[9px] font-bold flex-shrink-0 w-4 text-center"
            style={{ color: fileIcon(node.name).color }}
          >
            {fileIcon(node.name).label}
          </span>
        )}
        <span className="truncate font-mono">{node.name}</span>
      </button>
      <AnimatePresence initial={false}>
        {node.isDirectory && open && node.children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {node.children.map((child) => (
              <TreeNode key={child.path} node={child} depth={depth + 1} onPageMenu={onPageMenu} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FileTree() {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const importPage = useTemplateStore((s) => s.importPage);
  const templates = useTemplateStore((s) => s.templates);
  const [tree, setTree] = useState<FileTreeNode[]>([]);

  // 「导入为新页面」对话框状态
  const [pageDialogOpen, setPageDialogOpen] = useState(false);
  const [pageSource, setPageSource] = useState<string | null>(null);
  const [pageName, setPageName] = useState('');
  const [pageImporting, setPageImporting] = useState(false);

  // 右键菜单（页面管理）
  const pages = useTemplateStore((s) => s.pages);
  const renamePage = useTemplateStore((s) => s.renamePage);
  const duplicatePage = useTemplateStore((s) => s.duplicatePage);
  const removePage = useTemplateStore((s) => s.removePage);
  const movePage = useTemplateStore((s) => s.movePage);

  const [menu, setMenu] = useState<{ x: number; y: number; page: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // 重命名页面对话框
  const [renameDialog, setRenameDialog] = useState<{ target: string; value: string } | null>(null);
  // 删除页面二次确认
  const [deleteDialog, setDeleteDialog] = useState<{ target: string } | null>(null);

  function openPageMenu(e: ReactMouseEvent, page: string): void {
    setMenu({ x: e.clientX, y: e.clientY, page });
  }

  // 菜单/对话框期间禁用浏览器原生右键菜单以外的状态保持简单：点击即关
  useEffect(() => {
    if (!menu) return;
    function close(): void {
      setMenu(null);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenu(null);
    }
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  async function handlePageMove(direction: -1 | 1): Promise<void> {
    if (!menu || busy) return;
    const page = menu.page;
    setMenu(null);
    setBusy(true);
    try {
      await movePage(page, direction);
    } finally {
      setBusy(false);
    }
  }

  function askPageRename(page: string): void {
    setMenu(null);
    // 默认值取目录名/文件名（去扩展名）
    const seg = page.includes('/')
      ? page.slice(0, page.lastIndexOf('/')).split('/').pop() || ''
      : page.replace(/\.html?$/i, '');
    setRenameDialog({ target: page, value: seg });
  }

  async function confirmRename(): Promise<void> {
    if (!renameDialog || busy) return;
    const value = renameDialog.value.trim();
    if (!value || value === renameDialog.target) {
      setRenameDialog(null);
      return;
    }
    setBusy(true);
    try {
      const newPage = await renamePage(renameDialog.target, value);
      if (newPage) await reloadTree();
      setRenameDialog(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicatePage(page: string): Promise<void> {
    if (busy) return;
    setMenu(null);
    setBusy(true);
    try {
      const newPage = await duplicatePage(page);
      if (newPage) {
        await reloadTree();
        await fetchTemplates();
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteDialog || busy) return;
    setBusy(true);
    try {
      const ok = await removePage(deleteDialog.target);
      if (ok) {
        await reloadTree();
        await fetchTemplates();
      }
      setDeleteDialog(null);
    } finally {
      setBusy(false);
    }
  }

  // 重新加载当前模板的文件树（导入页面后调用）
  async function reloadTree() {
    const name = useTemplateStore.getState().currentTemplate;
    if (!name) {
      setTree([]);
      return;
    }
    try {
      const res = await window.wt.listFiles({ templateName: name });
      setTree(res.tree);
    } catch {
      setTree([]);
    }
  }

  // 切换模板时重新加载文件树
  useEffect(() => {
    if (!currentTemplate) {
      setTree([]);
      return;
    }
    let cancelled = false;
    window.wt
      .listFiles({ templateName: currentTemplate })
      .then((res) => {
        if (!cancelled) setTree(res.tree);
      })
      .catch(() => {
        if (!cancelled) setTree([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentTemplate]);

  function openPageDialog() {
    setPageSource(null);
    setPageName('');
    setPageDialogOpen(true);
  }

  // 命令面板意图：导入为新页面（新建工作区/导入模板由全局对话框宿主处理）
  useEffect(() =>
    onIntent((id) => {
      if (id === 'new-page') openPageDialog();
    })
  );

  async function confirmImportPage() {
    if (pageImporting || !currentTemplate || !pageSource) return;
    setPageImporting(true);
    try {
      const pagePath = await importPage(pageSource, pageName.trim() || undefined);
      if (pagePath) {
        await reloadTree();
        await fetchTemplates();
        setPageDialogOpen(false);
      }
    } finally {
      setPageImporting(false);
    }
  }

  // 可作为新页面来源的模板（排除当前模板自身），按工作区/模板库两区拆分
  const pageSources = templates.filter((t) => t.name !== currentTemplate);
  const pageSourceWorkspaces = pageSources.filter((t) => !t.source || t.source === 'custom');
  const pageSourceLibrary = pageSources.filter(
    (t) => t.source === 'market' || t.source === 'import'
  );

  return (
    <aside className="w-full h-full bg-wt-surface border-r border-wt-border flex flex-col">
      <div className="px-3 py-2 border-b border-wt-border flex items-center justify-between">
        <div className="text-[10px] text-wt-muted uppercase tracking-[0.15em]">资源管理器</div>
        <div className="flex items-center gap-1">
          <button
            onClick={openPageDialog}
            disabled={!currentTemplate || pageImporting}
            className="text-[10px] px-2 py-0.5 rounded text-wt-muted border border-wt-border hover:text-wt-text hover:bg-wt-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="把工作区中的另一个模板作为新页面加入当前模板"
          >
            ＋ 页面
          </button>
        </div>
      </div>

      {/* 当前工作区的文件树（工作区/模板库/草稿管理已移至主页） */}
      <div className="flex-1 overflow-y-auto py-1">
        {currentTemplate ? (
          tree.length > 0 ? (
            tree.map((node) => (
              <TreeNode key={node.path} node={node} depth={0} onPageMenu={openPageMenu} />
            ))
          ) : (
            <div className="text-wt-muted text-xs px-3 py-4">无文件</div>
          )
        ) : (
          <div className="text-wt-muted text-xs px-3 py-4 leading-relaxed">
            请选择或导入一个模板。
          </div>
        )}
      </div>

      {/* 从工作区模板导入为新页面 */}
      <AnimatePresence>
        {pageDialogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
            onClick={() => !pageImporting && setPageDialogOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-[400px] max-h-[80vh] flex flex-col bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-wt-text mb-1">从工作区导入新页面</div>
              <div className="text-xs text-wt-muted leading-relaxed mb-3">
                将所选模板整体复制为 <span className="font-mono text-wt-text">{currentTemplate}</span> 的一个子页面，
                其样式与图片资源保持相对路径独立可用。
              </div>

              <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1">选择来源模板</div>
              <div className="flex-1 min-h-[120px] max-h-[300px] overflow-y-auto rounded-md border border-wt-border bg-wt-bg mb-3">
                {pageSources.length > 0 ? (
                  <>
                    <SourceListGroup
                      title="我的工作区"
                      items={pageSourceWorkspaces}
                      active={pageSource}
                      onPick={(name) => {
                        setPageSource(name);
                        setPageName((prev) => prev || name);
                      }}
                    />
                    <SourceListGroup
                      title="模板库"
                      items={pageSourceLibrary}
                      active={pageSource}
                      onPick={(name) => {
                        setPageSource(name);
                        setPageName((prev) => prev || name);
                      }}
                    />
                  </>
                ) : (
                  <div className="text-xs text-wt-muted px-3 py-6 text-center leading-relaxed">
                    工作区中没有其他模板。
                    <br />
                    可先从市场复制或从磁盘导入一个模板。
                  </div>
                )}
              </div>

              <label className="block mb-4">
                <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1">
                  页面目录名（可改，支持中文；重名自动加后缀）
                </div>
                <input
                  value={pageName}
                  onChange={(e) => setPageName(e.target.value)}
                  placeholder="例如：about"
                  spellCheck={false}
                  className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs font-mono text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setPageDialogOpen(false)}
                  disabled={pageImporting}
                  className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmImportPage}
                  disabled={pageImporting || !pageSource}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {pageImporting ? '导入中…' : '导入为新页面'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 右键菜单：页面管理 */}
      {menu && (
        <div
          className="fixed z-[60] min-w-[168px] py-1 rounded-md border border-wt-border bg-wt-surface shadow-wt-lg"
          style={{
            left: Math.max(4, Math.min(menu.x, window.innerWidth - 180)),
            top: Math.max(4, Math.min(menu.y, window.innerHeight - 220))
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {(() => {
              const idx = pages.indexOf(menu.page);
              const isRoot = menu.page === 'index.html';
              const itemBase =
                'w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors';
              const enabled = 'text-wt-muted hover:bg-wt-surface-2 hover:text-wt-text';
              const disabled = 'text-wt-muted/35 cursor-not-allowed';
              return (
                <>
                  <div className="px-3 pb-1 mb-0.5 text-[9px] uppercase tracking-[0.1em] text-wt-muted/60 border-b border-wt-border/60 truncate font-mono">
                    {menu.page}
                  </div>
                  <button
                    className={`${itemBase} ${idx > 1 ? enabled : disabled}`}
                    disabled={idx <= 1 || busy}
                    onClick={() => void handlePageMove(-1)}
                  >
                    <span>上移</span>
                    <span className="text-[10px] opacity-60">↑</span>
                  </button>
                  <button
                    className={`${itemBase} ${idx >= 1 && idx < pages.length - 1 ? enabled : disabled}`}
                    disabled={idx < 1 || idx >= pages.length - 1 || busy}
                    onClick={() => void handlePageMove(1)}
                  >
                    <span>下移</span>
                    <span className="text-[10px] opacity-60">↓</span>
                  </button>
                  <button
                    className={`${itemBase} ${!isRoot ? enabled : disabled}`}
                    disabled={isRoot || busy}
                    onClick={() => askPageRename(menu.page)}
                  >
                    <span>重命名…</span>
                  </button>
                  <button
                    className={`${itemBase} ${enabled}`}
                    disabled={busy}
                    onClick={() => void handleDuplicatePage(menu.page)}
                  >
                    <span>复制页面</span>
                  </button>
                  <button
                    className={`${itemBase} ${!isRoot ? 'text-wt-danger/80 hover:bg-wt-danger/15 hover:text-wt-danger' : disabled}`}
                    disabled={isRoot || busy}
                    onClick={() => {
                      setMenu(null);
                      setDeleteDialog({ target: menu.page });
                    }}
                  >
                    <span>删除…</span>
                  </button>
                  {isRoot && (
                    <div className="px-3 pt-1 text-[9px] leading-snug text-wt-muted/50">
                      主页 index.html 不可重命名或删除
                    </div>
                  )}
                </>
              );
            })()}
        </div>
      )}

      {/* 重命名页面对话框 */}
      <AnimatePresence>
        {renameDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center"
            onClick={() => !busy && setRenameDialog(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-[380px] bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-wt-text mb-1">重命名页面</div>
              <div className="text-xs text-wt-muted leading-relaxed mb-3">
                页面目录将整体改名（资源随目录移动），并
                <span className="text-wt-text">自动重写全站指向该页的站内链接</span>。
                重名时自动追加后缀。
              </div>
              <label className="block mb-4">
                <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1">
                  页面目录名
                </div>
                <input
                  autoFocus
                  value={renameDialog.value}
                  onChange={(e) =>
                    setRenameDialog((d) => (d ? { ...d, value: e.target.value } : d))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void confirmRename();
                  }}
                  spellCheck={false}
                  className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRenameDialog(null)}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmRename}
                  disabled={busy || !renameDialog.value.trim()}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {busy ? '处理中…' : '重命名'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 删除页面二次确认 */}
      <AnimatePresence>
        {deleteDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center"
            onClick={() => !busy && setDeleteDialog(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-[400px] bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-wt-text mb-2">删除页面？</div>
              <div className="text-xs text-wt-muted leading-relaxed">
                将删除页面文件与目录内全部资源：
                <span className="font-mono text-wt-text"> {deleteDialog.target}</span>。
                <br />
                其他页面中指向它的链接会自动改回主页
                <span className="font-mono text-wt-text"> index.html</span>。
                <span className="text-wt-warning">此操作不可撤销。</span>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setDeleteDialog(null)}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={busy}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-md bg-wt-danger hover:bg-wt-danger/85 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {busy ? '删除中…' : '确认删除'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}
