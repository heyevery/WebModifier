// src/components/Sidebar/TemplateList.tsx
// 左侧模板列表 + 导入模板入口

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';

type NoticeTone = 'success' | 'warn' | 'error';

interface Notice {
  tone: NoticeTone;
  text: string;
}

export function TemplateList() {
  const templates = useTemplateStore((s) => s.templates);
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const openTemplate = useTemplateStore((s) => s.openTemplate);

  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  function showNotice(n: Notice): void {
    setNotice(n);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  }

  async function handleImport(): Promise<void> {
    if (importing) return;
    setImporting(true);
    try {
      const res = await window.wt.importTemplate();
      if (res.canceled) return;
      await fetchTemplates();
      await openTemplate(res.name);
      if (res.regionCount > 0) {
        showNotice({
          tone: 'success',
          text: `已导入「${res.name}」，识别到 ${res.regionCount} 个可编辑区段`
        });
      } else {
        showNotice({
          tone: 'warn',
          text: `「${res.name}」已导入，但未发现 @wt:edit 标记，暂无可编辑区段`
        });
      }
    } catch (e) {
      showNotice({ tone: 'error', text: `导入失败：${String(e)}` });
    } finally {
      setImporting(false);
    }
  }

  const toneClass: Record<NoticeTone, string> = {
    success: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    error: 'bg-red-500/10 text-red-300 border-red-500/30'
  };

  return (
    <aside className="w-[240px] flex-shrink-0 h-full bg-wt-surface border-r border-wt-border flex flex-col">
      <div className="px-4 py-3 border-b border-wt-border flex items-center justify-between">
        <div className="text-[10px] text-wt-muted uppercase tracking-[0.15em]">模板库</div>
        <button
          onClick={handleImport}
          disabled={importing}
          className="text-[10px] px-2 py-1 rounded-md bg-wt-primary/15 text-wt-primary
                     hover:bg-wt-primary/25 transition-colors disabled:opacity-50
                     disabled:cursor-not-allowed"
          title="从本地导入 HTML 文件或模板文件夹"
        >
          {importing ? '导入中…' : '＋ 导入'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {templates.length === 0 ? (
          <div className="text-wt-muted text-xs px-2 py-4 leading-relaxed">
            暂无模板。
            <br />
            点击右上角「＋ 导入」选择本地 HTML 文件或模板文件夹。
          </div>
        ) : (
          <ul className="space-y-1">
            {templates.map((t, i) => {
              const isActive = currentTemplate === t.name;
              return (
                <motion.li
                  key={t.name}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18, delay: i * 0.04 }}
                >
                  <button
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between group ${
                      isActive
                        ? 'bg-wt-primary/15 text-wt-text'
                        : 'text-wt-muted hover:bg-wt-surface-2 hover:text-wt-text'
                    }`}
                    onClick={() => openTemplate(t.name)}
                  >
                    <span className="font-mono truncate">{t.name}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {(t.pageCount ?? 1) > 1 && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-wt-primary/15 text-wt-primary"
                          title={`多页网站：${t.pageCount} 个 HTML 页面`}
                        >
                          {t.pageCount} 页
                        </span>
                      )}
                      {t.hasConfig && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-wt-accent/15 text-wt-accent"
                          title="含 config.wt.json"
                        >
                          cfg
                        </span>
                      )}
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className={`mx-2 mb-2 px-3 py-2 rounded-md border text-[11px] leading-relaxed ${toneClass[notice.tone]}`}
          >
            {notice.text}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-3 py-2 border-t border-wt-border text-[10px] text-wt-muted">
        模板总数: {templates.length}
      </div>
    </aside>
  );
}
