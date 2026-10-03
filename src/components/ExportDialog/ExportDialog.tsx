// src/components/ExportDialog/ExportDialog.tsx
// 导出模态框：自定义导出名称 + 选择目录 + 同名覆盖提示

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import { toast } from '@/components/Toast/toast';
import { summarizeIssues, type HealthIssue } from '@shared/health-check';
import type { ExportTemplateResult } from '@shared/types/ipc';

interface Props {
  open: boolean;
  onClose: () => void;
}

// 与主进程 sanitizeExportName 保持一致的前端预览过滤
function previewName(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\./g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function ExportDialog({ open, onClose }: Props) {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const exportTemplate = useTemplateStore((s) => s.exportTemplate);
  const checkExportHealth = useTemplateStore((s) => s.checkExportHealth);

  const [name, setName] = useState('');
  const [dir, setDir] = useState<string | null>(null); // null = 主进程默认导出目录
  const [defaultDir, setDefaultDir] = useState('…'); // 真实默认目录（打包后为 文档/Web Modifier 导出）
  const [exists, setExists] = useState(false);
  const [zip, setZip] = useState(true); // 默认打包为 ZIP
  const [busy, setBusy] = useState(false);
  // 导出成功结果：非 null 时切换到成功面板（提供打开目录 / 浏览器打开）
  const [done, setDone] = useState<ExportTemplateResult | null>(null);
  const [opening, setOpening] = useState(false);
  // 导出前健康检查：idle 未跑 / running 扫描中 / done 有结果（只读报告，不阻断导出）
  const [health, setHealth] = useState<
    { status: 'idle' } | { status: 'running' } | { status: 'done'; pagesScanned: number; issues: HealthIssue[] }
  >({ status: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const checkTimer = useRef<number | null>(null);

  async function runHealthCheck(): Promise<void> {
    setHealth({ status: 'running' });
    const res = await checkExportHealth();
    // null = 检查本身失败，store.error 已桥接 Toast；回到未跑态允许重试
    setHealth(res ? { status: 'done', ...res } : { status: 'idle' });
  }

  // 打开时初始化默认名称 + 真实导出目录 + 自动跑一次健康检查
  useEffect(() => {
    if (open) {
      setName(currentTemplate || '');
      setExists(false);
      setDone(null);
      setHealth({ status: 'idle' });
      void runHealthCheck();
      window.wt
        .getExportDir()
        .then((r) => setDefaultDir(r.dir))
        .catch(() => setDefaultDir('exports'));
      // 自动聚焦并全选，方便直接输入覆盖
      setTimeout(() => inputRef.current?.select(), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentTemplate]);

  // 名称/目录变化时防抖检查同名
  useEffect(() => {
    if (!open) return;
    if (checkTimer.current) window.clearTimeout(checkTimer.current);
    const safe = previewName(name);
    if (!safe) {
      setExists(false);
      return;
    }
    checkTimer.current = window.setTimeout(async () => {
      try {
        const res = await window.wt.checkExport({ exportName: safe, targetDir: dir ?? undefined });
        setExists(res.exists);
      } catch {
        setExists(false);
      }
    }, 350);
    return () => {
      if (checkTimer.current) window.clearTimeout(checkTimer.current);
    };
  }, [name, dir, open]);

  const safe = previewName(name);
  const canExport = safe.length > 0 && !busy;

  async function handleExport(): Promise<void> {
    if (!canExport) return;
    setBusy(true);
    const res = await exportTemplate(safe, dir ?? undefined, zip);
    setBusy(false);
    if (res) setDone(res);
  }

  /** 调系统外壳；siteRoot = 导出网站目录（outputPath 的目录部分） */
  async function shellOpen(target: string, reveal = false): Promise<void> {
    setOpening(true);
    try {
      const r = await window.wt.openPath({ target, reveal });
      if (!r.ok) toast.error(`打开失败：${r.error ?? '未知错误'}`);
    } finally {
      setOpening(false);
    }
  }

  async function handlePickDir(): Promise<void> {
    try {
      const res = await window.wt.pickDirectory();
      if (res.dir) setDir(res.dir);
    } catch {
      // 用户取消，保持原目录
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="w-[420px] bg-wt-surface border border-wt-border rounded-xl shadow-2xl p-5"
          >
            {done ? (
              <>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-base">✅</span>
                  <h3 className="text-sm font-semibold text-wt-text">导出完成</h3>
                </div>
                <div className="mb-4 px-3 py-2 rounded-md bg-wt-bg border border-wt-border text-[11px] text-wt-muted font-mono break-all leading-relaxed">
                  {done.zipPath ? (
                    <>
                      <div className="text-wt-text">{done.zipPath}</div>
                      <div className="mt-0.5">（ZIP 压缩包，网站目录在同路径同名文件夹内）</div>
                    </>
                  ) : (
                    done.outputPath
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {done.zipPath ? (
                    <button
                      disabled={opening}
                      onClick={() => void shellOpen(done.zipPath!, true)}
                      className="w-full px-3 py-2 text-[13px] font-medium rounded-md bg-wt-primary
                                 hover:bg-wt-primary-hover text-white transition-colors
                                 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      在资源管理器中查看 ZIP
                    </button>
                  ) : (
                    <button
                      disabled={opening}
                      onClick={() => void shellOpen(done.outputPath)}
                      className="w-full px-3 py-2 text-[13px] font-medium rounded-md bg-wt-primary
                                 hover:bg-wt-primary-hover text-white transition-colors
                                 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      在浏览器中打开网站
                    </button>
                  )}
                  <button
                    disabled={opening}
                    onClick={() =>
                      void shellOpen(done.outputPath.replace(/[\\/][^\\/]*$/, ''))
                    }
                    className="w-full px-3 py-1.5 text-[12px] rounded-md text-wt-muted
                               hover:text-wt-text hover:bg-wt-surface-2 transition-colors
                               disabled:opacity-40"
                  >
                    打开导出目录
                  </button>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={onClose}
                    className="px-4 py-1.5 text-sm rounded-md text-wt-muted hover:text-wt-text
                               hover:bg-wt-surface-2 transition-colors"
                  >
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-wt-text">导出模板</h3>
              <span className="text-xs text-wt-muted font-mono truncate max-w-[220px]">
                {currentTemplate}
              </span>
            </div>

            <label className="block text-xs text-wt-muted mb-1.5">导出名称</label>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleExport();
                if (e.key === 'Escape') onClose();
              }}
              placeholder="输入导出名称…"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-md bg-wt-bg border border-wt-border text-sm text-wt-text
                         focus:outline-none focus:border-wt-primary transition-colors"
            />

            {/* 导出位置预览 */}
            <div className="mt-3 px-3 py-2 rounded-md bg-wt-bg border border-wt-border text-[11px] text-wt-muted font-mono break-all">
              {dir ? dir : defaultDir}/{safe || '…'}/index.html
            </div>

            <div className="mt-2.5 flex items-center justify-between">
              <button
                onClick={handlePickDir}
                className="text-[11px] px-2 py-1 rounded-md bg-wt-surface-2 text-wt-muted
                           hover:text-wt-text transition-colors"
              >
                更改导出位置
              </button>
              <AnimatePresence>
                {exists && safe && (
                  <motion.span
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-wt-warning"
                  >
                    已存在同名导出，将覆盖
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* ZIP 打包选项 */}
            <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={zip}
                onChange={(e) => setZip(e.target.checked)}
                className="w-4 h-4 accent-wt-primary"
              />
              <span className="text-xs text-wt-text">导出后自动打包为 ZIP 压缩包</span>
            </label>

            {/* 导出前健康检查（只读报告，不阻断导出） */}
            <div className="mt-3 rounded-md border border-wt-border bg-wt-bg overflow-hidden">
              <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-wt-border">
                <span className="text-[11px] text-wt-muted">导出前检查</span>
                <button
                  onClick={() => void runHealthCheck()}
                  disabled={health.status === 'running'}
                  className="text-[10px] px-1.5 py-0.5 rounded text-wt-muted border border-wt-border
                             hover:text-wt-text hover:bg-wt-surface-2 transition-colors
                             disabled:opacity-40"
                >
                  {health.status === 'running' ? '检查中…' : '重新检查'}
                </button>
              </div>
              {health.status === 'running' && (
                <div className="px-2.5 py-2 text-[11px] text-wt-muted">正在扫描站内链接、图片与页面信息…</div>
              )}
              {health.status === 'idle' && (
                <div className="px-2.5 py-2 text-[11px] text-wt-muted">未运行检查</div>
              )}
              {health.status === 'done' && health.issues.length === 0 && (
                <div className="px-2.5 py-2 text-[11px] text-wt-success">
                  ✓ 未发现问题（已扫描 {health.pagesScanned} 个页面）
                </div>
              )}
              {health.status === 'done' && health.issues.length > 0 && (
                <div>
                  {(() => {
                    const { errors, warnings } = summarizeIssues(health.issues);
                    return (
                      <div className="px-2.5 py-1.5 text-[11px] flex items-center gap-2">
                        <span className={errors ? 'text-wt-danger' : 'text-wt-success'}>
                          {errors} 个错误
                        </span>
                        <span className="text-wt-warning">{warnings} 个提醒</span>
                        <span className="text-wt-muted">· 共 {health.pagesScanned} 页</span>
                      </div>
                    );
                  })()}
                  <ul className="max-h-32 overflow-y-auto px-2.5 pb-2 flex flex-col gap-1">
                    {health.issues.map((it, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug">
                        <span className={`flex-shrink-0 mt-px ${it.severity === 'error' ? 'text-wt-danger' : 'text-wt-warning'}`}>
                          {it.severity === 'error' ? '✕' : '⚠'}
                        </span>
                        <span className="flex-1 text-wt-text break-words">{it.message}</span>
                        <span className="flex-shrink-0 text-[10px] text-wt-muted font-mono mt-px">{it.page}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="px-2.5 py-1.5 border-t border-wt-border text-[10px] text-wt-muted">
                    检查不会修改页面，仍可照常导出。
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-sm rounded-md text-wt-muted hover:text-wt-text
                           hover:bg-wt-surface-2 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleExport}
                disabled={!canExport}
                className="px-4 py-1.5 text-sm font-medium rounded-md bg-wt-primary
                           hover:bg-wt-primary-hover text-white transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? '导出中…' : '导出'}
              </button>
            </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
