// src/components/Home/HomePage.tsx
// 主页（无打开工作区时的主区域）：
// 我的项目（草稿）/ 我的工作区 / 模板库 三个分区各自成区，
// 不再挤在资源管理器侧栏内。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import type { TemplateMeta } from '@shared/types/region';
import type { ProjectMeta } from '@shared/types/ipc';
import { emitIntent } from '@/lib/intents';
import { openPalette } from '@/components/CommandPalette/CommandPalette';
import { toast } from '@/components/Toast/toast';

/** 相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期） */
function relTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

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

// ============================== 工作区/模板卡片 ==============================

function TemplateCard({
  template,
  onManage
}: {
  template: TemplateMeta;
  onManage: (t: TemplateMeta, anchor: HTMLButtonElement) => void;
}) {
  const openTemplate = useTemplateStore((s) => s.openTemplate);
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const badge = sourceBadge(template.source);
  const active = currentTemplate === template.name;

  return (
    <div
      onClick={() => void openTemplate(template.name)}
      className={`group relative cursor-pointer rounded-md border p-3 transition-colors
        ${active
          ? 'border-wt-primary/60 bg-wt-primary/10'
          : 'border-wt-border bg-wt-surface hover:border-wt-border-strong hover:bg-wt-surface-2'}`}
    >
      <div className="flex items-start gap-2 pr-6">
        <span className="text-base leading-5">🧩</span>
        <div className="min-w-0">
          <div className="text-[13px] text-wt-text truncate font-medium" title={template.name}>
            {template.name}
          </div>
          <div className="mt-0.5 text-[11px] text-wt-muted">
            {template.pageCount && template.pageCount > 1
              ? `${template.pageCount} 个页面`
              : '单页网站'}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1">
        {badge && (
          <span className={`text-[9px] px-1 rounded leading-relaxed ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onManage(template, e.currentTarget);
        }}
        title="管理：重命名 / 另存副本 / 删除"
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-sm text-wt-muted
                   hover:text-wt-text hover:bg-wt-input flex items-center justify-center
                   opacity-0 group-hover:opacity-100 transition-opacity text-base leading-none"
      >
        ⋯
      </button>
    </div>
  );
}

// ============================== 项目草稿卡片 ==============================

function ProjectCard({
  project,
  onDelete
}: {
  project: ProjectMeta;
  onDelete: (p: ProjectMeta) => void;
}) {
  const openProject = useTemplateStore((s) => s.openProject);
  const currentProjectId = useTemplateStore((s) => s.currentProjectId);
  const active = currentProjectId === project.id;

  return (
    <div
      className={`relative rounded-md border p-3 flex flex-col
        ${active
          ? 'border-wt-primary/60 bg-wt-primary/10'
          : project.templateExists
            ? 'border-wt-border bg-wt-surface hover:border-wt-border-strong'
            : 'border-wt-border bg-wt-surface opacity-60'}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-base leading-5">📦</span>
        <div className="min-w-0">
          <div className="text-[13px] text-wt-text truncate font-medium" title={project.name}>
            {project.name}
          </div>
          <div className="mt-0.5 text-[11px] text-wt-muted truncate" title={project.templateName}>
            源：{project.templateName}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-wt-muted/80">
        {project.editCount} 处内容修改
        {project.cssCount ? ` · ${project.cssCount} 个样式文件` : ''} · 更新于{' '}
        {relTime(project.updatedAt)}
        {!project.templateExists && <span className="text-wt-warning"> · 源模板已删除</span>}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          onClick={() => project.templateExists && void openProject(project.id)}
          disabled={!project.templateExists}
          className="h-6 px-2 text-[11px] rounded-sm bg-wt-primary/15 text-wt-primary
                     hover:bg-wt-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={project.templateExists ? '打开草稿继续编辑' : '源模板已删除，无法打开'}
        >
          打开
        </button>
        <button
          onClick={() => onDelete(project)}
          className="h-6 px-2 text-[11px] rounded-sm text-wt-muted hover:text-wt-danger
                     hover:bg-wt-danger/15 transition-colors"
          title="删除草稿（不影响模板与导出文件）"
        >
          删除
        </button>
      </div>
    </div>
  );
}

// ============================== 分区容器 ==============================

function Section({
  icon,
  title,
  count,
  action,
  children
}: {
  icon: string;
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-2.5 px-0.5">
        <span>{icon}</span>
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-wt-muted font-medium">
          {title}
        </h2>
        <span className="text-[11px] text-wt-muted/50">{count}</span>
        <div className="ml-auto flex items-center gap-1.5">{action}</div>
      </div>
      {children}
    </section>
  );
}

const cardGrid = 'grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]';

// ============================== 主页 ==============================

export function HomePage() {
  const templates = useTemplateStore((s) => s.templates);
  const projects = useTemplateStore((s) => s.projects);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const fetchProjects = useTemplateStore((s) => s.fetchProjects);
  const removeProject = useTemplateStore((s) => s.removeProject);
  const setError = useTemplateStore((s) => s.setError);

  const workspaces = templates.filter((t) => !t.source || t.source === 'custom');
  const library = templates.filter((t) => t.source === 'market' || t.source === 'import');

  // 卡片 ⋯ 菜单（锚定按钮定位）
  const [menu, setMenu] = useState<{ template: TemplateMeta; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  // 重命名对话框
  const [renameTarget, setRenameTarget] = useState<TemplateMeta | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // 另存副本对话框（可命名，留空走后端默认 name-copy）
  const [duplicateTarget, setDuplicateTarget] = useState<TemplateMeta | null>(null);
  const [duplicateValue, setDuplicateValue] = useState('');
  // 删除确认（工作区 / 草稿）
  const [deleteTemplate, setDeleteTemplate] = useState<TemplateMeta | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<ProjectMeta | null>(null);

  // 菜单外部点击关闭
  useEffect(() => {
    if (!menu) return;
    function onDown(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenu(null);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  function openCardMenu(t: TemplateMeta, anchor: HTMLButtonElement): void {
    const r = anchor.getBoundingClientRect();
    setMenu({ template: t, x: r.right, y: r.bottom + 4 });
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([fetchTemplates(), fetchProjects()]);
  }

  function askRename(t: TemplateMeta): void {
    setMenu(null);
    setRenameValue(t.name);
    setRenameTarget(t);
  }

  async function confirmRename(): Promise<void> {
    if (!renameTarget || busy) return;
    const name = renameValue.trim();
    if (!name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    setBusy(true);
    try {
      const res = await window.wt.manageTemplate({
        templateName: renameTarget.name,
        action: 'rename',
        newName: name
      });
      if (res.ok) {
        await refreshAll();
        toast.success(`已重命名为「${res.name ?? name}」`);
      } else setError('重命名失败（可能名称非法或被占用）');
      setRenameTarget(null);
    } catch (e) {
      setError(`重命名失败: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function askDuplicate(t: TemplateMeta): void {
    setMenu(null);
    setDuplicateValue(`${t.name}-copy`);
    setDuplicateTarget(t);
  }

  async function confirmDuplicate(): Promise<void> {
    if (!duplicateTarget || busy) return;
    const name = duplicateValue.trim();
    setBusy(true);
    try {
      const res = await window.wt.manageTemplate({
        templateName: duplicateTarget.name,
        action: 'duplicate',
        newName: name || undefined
      });
      if (res.ok) {
        await fetchTemplates();
        toast.success(`已创建副本「${res.name ?? name}」`);
      } else setError('另存副本失败');
      setDuplicateTarget(null);
    } catch (e) {
      setError(`另存副本失败: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteTemplate(): Promise<void> {
    if (!deleteTemplate || busy) return;
    setBusy(true);
    try {
      const res = await window.wt.manageTemplate({
        templateName: deleteTemplate.name,
        action: 'delete'
      });
      if (res.ok) {
        await refreshAll();
        const extra = res.removedProjects ? `（连带删除 ${res.removedProjects} 个项目草稿）` : '';
        toast.success(`已删除「${deleteTemplate.name}」${extra}`);
      } else setError(res.error ? `删除失败：${res.error}` : '删除失败：文件可能被占用，请关闭占用程序后重试');
      setDeleteTemplate(null);
    } catch (e) {
      setError(`删除失败: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteProject(): Promise<void> {
    if (!deleteProjectTarget || busy) return;
    setBusy(true);
    try {
      const target = deleteProjectTarget;
      await removeProject(target.id);
      toast.success(`已删除项目草稿「${target.name}」`);
      setDeleteProjectTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const newBtn =
    'h-7 px-3 text-[12px] rounded-sm transition-colors disabled:opacity-40';

  // 删除工作区时将被连带清理的项目草稿（自动草稿不进 projects 列表，文案中统一提示）
  const deleteRefProjects = deleteTemplate
    ? projects.filter((p) => p.templateName === deleteTemplate.name)
    : [];

  return (
    <div className="h-full overflow-y-auto bg-wt-bg">
      <div className="max-w-[1000px] mx-auto px-8 py-10">
        {/* 顶部：标题 + 搜索入口 + 操作 */}
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-7 h-7 rounded-sm bg-wt-accent flex-shrink-0" />
          <h1 className="text-[18px] font-semibold text-wt-text">Web Modifier</h1>
        </div>
        <p className="text-[12px] text-wt-muted mb-5">
          选择工作区继续编辑，或从模板库新建网站
        </p>

        <button
          onClick={() => openPalette('commands')}
          className="w-full max-w-[520px] h-9 flex items-center gap-2.5 px-3 rounded-md
                     border border-wt-border bg-wt-surface text-wt-muted
                     hover:border-wt-border-strong hover:text-wt-text transition-colors mb-3"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="text-[13px]">搜索页面或执行命令</span>
          <span className="ml-auto text-[10px] font-mono opacity-60 flex-shrink-0">
            Ctrl+Shift+P
          </span>
        </button>

        <div className="flex items-center gap-2 mb-9">
          <button
            onClick={() => emitIntent('new-workspace')}
            className={`${newBtn} bg-wt-primary hover:bg-wt-primary-hover text-white`}
          >
            ＋ 新建工作区
          </button>
          <button
            onClick={() => emitIntent('import-template')}
            className={`${newBtn} bg-wt-surface-2 text-wt-muted hover:text-wt-text hover:bg-wt-input border border-wt-border`}
          >
            ＋ 导入 HTML / 模板
          </button>
        </div>

        {/* 我的项目：继续编辑（最优先） */}
        <Section icon="📦" title="我的项目 · 草稿" count={projects.length}>
          {projects.length > 0 ? (
            <div className={cardGrid}>
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onDelete={setDeleteProjectTarget} />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-wt-border px-4 py-5 text-[12px] text-wt-muted/60">
              暂无草稿。打开任意工作区编辑后，点顶栏「💾 保存为项目」或按 Ctrl+S
            </div>
          )}
        </Section>

        {/* 我的工作区 */}
        <Section
          icon="📁"
          title="我的工作区"
          count={workspaces.length}
          action={
            <button
              onClick={() => emitIntent('new-workspace')}
              className="h-6 px-2 text-[11px] rounded-sm text-wt-muted border border-wt-border
                         hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
            >
              ＋ 新建
            </button>
          }
        >
          {workspaces.length > 0 ? (
            <div className={cardGrid}>
              {workspaces.map((t) => (
                <TemplateCard key={t.name} template={t} onManage={openCardMenu} />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-wt-border px-4 py-5 text-[12px] text-wt-muted/60">
              暂无工作区，点「＋ 新建工作区」创建
            </div>
          )}
        </Section>

        {/* 模板库 */}
        <Section icon="🧩" title="模板库" count={library.length}>
          {library.length > 0 ? (
            <div className={cardGrid}>
              {library.map((t) => (
                <TemplateCard key={t.name} template={t} onManage={openCardMenu} />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-wt-border px-4 py-5 text-[12px] text-wt-muted/60">
              模板库为空，可从左侧活动栏「模板市场」复制，或点上方「＋ 导入」
            </div>
          )}
        </Section>
      </div>

      {/* ⋯ 管理菜单 */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-[90] min-w-[150px] py-1 rounded-md border border-wt-border bg-wt-surface shadow-wt-lg"
          style={{
            left: Math.max(4, Math.min(menu.x - 160, window.innerWidth - 170)),
            top: Math.min(menu.y, window.innerHeight - 140)
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            disabled={busy}
            onClick={() => askRename(menu.template)}
            className="w-full px-3 py-1.5 text-left text-[12px] text-wt-muted hover:bg-wt-surface-2 hover:text-wt-text disabled:opacity-40"
          >
            重命名…
          </button>
          <button
            disabled={busy}
            onClick={() => askDuplicate(menu.template)}
            className="w-full px-3 py-1.5 text-left text-[12px] text-wt-muted hover:bg-wt-surface-2 hover:text-wt-text disabled:opacity-40"
          >
            另存副本…
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setDeleteTemplate(menu.template);
              setMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-[12px] text-wt-danger/85 hover:bg-wt-danger/15 hover:text-wt-danger disabled:opacity-40"
          >
            删除…
          </button>
        </div>
      )}

      {/* 重命名对话框 */}
      <AnimatePresence>
        {renameTarget && (
          <Modal onClose={() => !busy && setRenameTarget(null)} width="w-[380px]">
            <div className="text-sm font-medium text-wt-text mb-1">重命名工作区</div>
            <div className="text-xs text-wt-muted leading-relaxed mb-3">
              关联的项目草稿会自动指向新名称；重名时自动追加后缀。
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmRename();
              }}
              spellCheck={false}
              className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs text-wt-text
                         placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40 mb-4"
            />
            <DialogButtons
              busy={busy}
              confirmText="重命名"
              onCancel={() => setRenameTarget(null)}
              onConfirm={() => void confirmRename()}
              confirmDisabled={!renameValue.trim()}
            />
          </Modal>
        )}
      </AnimatePresence>

      {/* 另存副本对话框 */}
      <AnimatePresence>
        {duplicateTarget && (
          <Modal onClose={() => !busy && setDuplicateTarget(null)} width="w-[380px]">
            <div className="text-sm font-medium text-wt-text mb-1">另存为新工作区</div>
            <div className="text-xs text-wt-muted leading-relaxed mb-3">
              复制「<span className="text-wt-text">{duplicateTarget.name}</span>」的全部页面与资源，
              得到一个独立的新工作区；非法字符自动清洗，重名自动追加 -1、-2 后缀。
            </div>
            <input
              autoFocus
              value={duplicateValue}
              onChange={(e) => setDuplicateValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmDuplicate();
              }}
              spellCheck={false}
              placeholder="留空则使用 默认名-copy"
              className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs text-wt-text
                         placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40 mb-4"
            />
            <DialogButtons
              busy={busy}
              confirmText="创建副本"
              onCancel={() => setDuplicateTarget(null)}
              onConfirm={() => void confirmDuplicate()}
            />
          </Modal>
        )}
      </AnimatePresence>

      {/* 删除工作区确认 */}
      <AnimatePresence>
        {deleteTemplate && (
          <Modal onClose={() => !busy && setDeleteTemplate(null)} width="w-[420px]">
            <div className="text-sm font-medium text-wt-text mb-2">删除工作区？</div>
            <div className="text-xs text-wt-muted leading-relaxed">
              将永久删除工作区
              <span className="font-mono text-wt-text"> {deleteTemplate.name}</span>
              的全部文件（含原件快照），以及它的自动草稿（如有）。
              <span className="text-wt-warning">此操作不可撤销。</span>
            </div>
            {deleteRefProjects.length > 0 && (
              <div className="mt-2.5 rounded border border-wt-warning/40 bg-wt-warning/10 px-2.5 py-2 text-[11px] text-wt-warning leading-relaxed">
                另有 {deleteRefProjects.length} 个项目草稿以该工作区为源，也会一并永久删除：
                <span className="text-wt-text">
                  {deleteRefProjects
                    .slice(0, 3)
                    .map((p) => p.name)
                    .join('、')}
                  {deleteRefProjects.length > 3 ? ` 等 ${deleteRefProjects.length} 个` : ''}
                </span>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <DialogButtons
                busy={busy}
                confirmText="确认删除"
                danger
                onCancel={() => setDeleteTemplate(null)}
                onConfirm={() => void confirmDeleteTemplate()}
              />
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* 删除草稿确认 */}
      <AnimatePresence>
        {deleteProjectTarget && (
          <Modal onClose={() => !busy && setDeleteProjectTarget(null)} width="w-[400px]">
            <div className="text-sm font-medium text-wt-text mb-2">删除项目草稿？</div>
            <div className="text-xs text-wt-muted leading-relaxed">
              将删除草稿「<span className="text-wt-text">{deleteProjectTarget.name}</span>」
              （源模板：{deleteProjectTarget.templateName}）。
              <br />
              模板文件与已导出的网站不受影响。
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <DialogButtons
                busy={busy}
                confirmText="确认删除"
                danger
                onCancel={() => setDeleteProjectTarget(null)}
                onConfirm={() => void confirmDeleteProject()}
              />
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================== 通用小部件 ==============================

function Modal({
  children,
  onClose,
  width
}: {
  children: ReactNode;
  onClose: () => void;
  width: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 8 }}
        transition={{ duration: 0.15 }}
        className={`${width} bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function DialogButtons({
  busy,
  confirmText,
  onCancel,
  onConfirm,
  confirmDisabled,
  danger
}: {
  busy: boolean;
  confirmText: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  danger?: boolean;
}) {
  return (
    <>
      <button
        onClick={onCancel}
        disabled={busy}
        className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
      >
        取消
      </button>
      <button
        onClick={onConfirm}
        disabled={busy || confirmDisabled}
        className={`px-3.5 py-1.5 text-xs font-medium rounded-md text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          danger ? 'bg-wt-danger hover:bg-wt-danger/85' : 'bg-wt-primary hover:bg-wt-primary-hover'
        }`}
      >
        {busy ? '处理中…' : confirmText}
      </button>
    </>
  );
}
