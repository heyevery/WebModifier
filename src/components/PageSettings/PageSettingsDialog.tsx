// src/components/PageSettings/PageSettingsDialog.tsx
// 页面设置：title / meta description / favicon / <html lang>

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import type { PageMeta } from '@shared/types/region';

const EMPTY: PageMeta = { title: '', description: '', favicon: '', lang: '' };

const LANG_SUGGESTIONS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es'];

export function PageSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const currentPage = useTemplateStore((s) => s.currentPage);
  const metaByPage = useTemplateStore((s) => s.metaByPage);
  const savePageMeta = useTemplateStore((s) => s.savePageMeta);

  const [form, setForm] = useState<PageMeta>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  // 每次打开/切换页面时同步当前已保存值
  useEffect(() => {
    if (open) setForm(metaByPage[currentPage] ?? EMPTY);
  }, [open, currentPage, metaByPage]);

  const set = (patch: Partial<PageMeta>): void => setForm((f) => ({ ...f, ...patch }));

  async function handlePickFavicon(): Promise<void> {
    if (!currentTemplate || picking) return;
    setPicking(true);
    try {
      const res = await window.wt.pickImage({ templateName: currentTemplate, page: currentPage });
      if (!res.canceled && res.relativePath) set({ favicon: res.relativePath });
    } finally {
      setPicking(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (saving || !currentTemplate) return;
    setSaving(true);
    try {
      const ok = await savePageMeta(currentPage, {
        title: form.title.trim(),
        description: form.description.trim(),
        favicon: form.favicon.trim(),
        lang: form.lang.trim()
      });
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
          onClick={() => !saving && onClose()}
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            className="w-[440px] max-h-[85vh] overflow-y-auto bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-wt-text mb-1">页面设置</div>
            <div className="text-xs text-wt-muted leading-relaxed mb-4">
              设置将直接写入 <span className="font-mono text-wt-text">{currentPage}</span> 的
              <span className="font-mono text-wt-text"> {'<head>'}</span>，导出时随页面一起发布。
            </div>

            <label className="block mb-3.5">
              <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1">
                页面标题 title
              </div>
              <input
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="显示在浏览器标签页与收藏夹中的标题"
                spellCheck={false}
                className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
              />
            </label>

            <label className="block mb-3.5">
              <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1">
                页面描述 description
              </div>
              <textarea
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="搜索引擎结果中展示的摘要文字（建议 80–160 字）"
                rows={3}
                spellCheck={false}
                className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40 resize-none"
              />
            </label>

            <div className="mb-3.5">
              <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1">
                网站图标 favicon
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={form.favicon}
                  onChange={(e) => set({ favicon: e.target.value })}
                  placeholder="相对路径（如 assets/favicon.svg）或 http(s) 链接；留空清除"
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs font-mono text-wt-text placeholder:text-wt-muted/50 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
                />
                <button
                  onClick={handlePickFavicon}
                  disabled={picking || !currentTemplate}
                  className="flex-shrink-0 text-[11px] px-2.5 py-1.5 rounded border border-wt-border text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors disabled:opacity-40"
                >
                  {picking ? '选择中…' : '选择图片'}
                </button>
              </div>
            </div>

            <label className="block mb-5">
              <div className="text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1">
                页面语言 lang（html 标签）
              </div>
              <input
                value={form.lang}
                onChange={(e) => set({ lang: e.target.value })}
                placeholder="如 zh-CN；留空清除"
                list="wt-lang-suggestions"
                spellCheck={false}
                className="w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs font-mono text-wt-text placeholder:text-wt-muted/50 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
              />
              <datalist id="wt-lang-suggestions">
                {LANG_SUGGESTIONS.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !currentTemplate}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? '保存中…' : '保存设置'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
