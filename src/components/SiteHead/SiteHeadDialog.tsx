// src/components/SiteHead/SiteHeadDialog.tsx
// 全站 head 批量默认：favicon / 标题模式 / 统一 description / Open Graph
// 所有项「留空 = 不改动」；直接写入每个页面的 <head>（与页面设置同样的持久化语义）。

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import type { SiteTitleMode } from '@shared/site-head';
import { toast } from '@/components/Toast/toast';

const MODES: { value: SiteTitleMode; label: string; hint: string }[] = [
  { value: 'keep', label: '保持不变', hint: '各页保留自己的标题' },
  { value: 'replace', label: '统一标题', hint: '所有页面使用同一个标题' },
  { value: 'suffix', label: '追加后缀', hint: '如「首页」→「首页 - Acme 官网」，已含后缀不重复追加' }
];

const inputCls =
  'w-full bg-wt-bg border border-wt-border rounded px-2.5 py-1.5 text-xs text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40';
const monoInputCls = `${inputCls} font-mono placeholder:font-sans`;
const labelCls = 'text-[10px] text-wt-muted uppercase tracking-[0.12em] mb-1';

export function SiteHeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const pages = useTemplateStore((s) => s.pages);
  const applySiteHead = useTemplateStore((s) => s.applySiteHead);

  const [titleMode, setTitleMode] = useState<SiteTitleMode>('keep');
  const [titleText, setTitleText] = useState('');
  const [favicon, setFavicon] = useState('');
  const [description, setDescription] = useState('');
  const [ogEnabled, setOgEnabled] = useState(false);
  const [ogTitle, setOgTitle] = useState('');
  const [ogDescription, setOgDescription] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState<'favicon' | 'og' | null>(null);

  useEffect(() => {
    if (open) {
      setTitleMode('keep');
      setTitleText('');
      setFavicon('');
      setDescription('');
      setOgEnabled(false);
      setOgTitle('');
      setOgDescription('');
      setOgImage('');
    }
  }, [open]);

  const canApply = useMemo(() => {
    if (titleMode === 'replace' && !titleText.trim()) return false;
    if (titleMode === 'suffix' && !titleText.trim()) return false;
    return (
      titleMode !== 'keep' ||
      !!favicon.trim() ||
      !!description.trim() ||
      (ogEnabled && (!!ogTitle.trim() || !!ogDescription.trim() || !!ogImage.trim()))
    );
  }, [titleMode, titleText, favicon, description, ogEnabled, ogTitle, ogDescription, ogImage]);

  async function handlePick(target: 'favicon' | 'og'): Promise<void> {
    if (!currentTemplate || picking) return;
    setPicking(target);
    try {
      // 全站资源按站点根约定选取（图片复制到根级 assets/，返回根相对路径）
      const res = await window.wt.pickImage({ templateName: currentTemplate, page: 'index.html' });
      if (!res.canceled && res.relativePath) {
        if (target === 'favicon') setFavicon(res.relativePath);
        else setOgImage(res.relativePath);
      }
    } finally {
      setPicking(null);
    }
  }

  async function handleApply(): Promise<void> {
    if (saving || !currentTemplate || !canApply) return;
    setSaving(true);
    try {
      const result = await applySiteHead({
        titleMode: titleMode === 'keep' ? undefined : titleMode,
        titleText: titleMode === 'keep' ? undefined : titleText,
        favicon: favicon.trim() || undefined,
        description: description.trim() || undefined,
        ogEnabled,
        ogTitle: ogEnabled ? ogTitle.trim() || undefined : undefined,
        ogDescription: ogEnabled ? ogDescription.trim() || undefined : undefined,
        ogImage: ogEnabled ? ogImage.trim() || undefined : undefined
      });
      if (result) {
        if (result.changedPages > 0) {
          toast.success(`已将全站 head 设置写入 ${result.changedPages}/${result.pagesScanned} 个页面`);
          onClose();
        } else {
          toast.info('所有页面均已符合设置，无需更新');
        }
      }
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
            className="w-[480px] max-h-[85vh] overflow-y-auto bg-wt-surface border border-wt-border rounded-lg shadow-wt-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-wt-text mb-1">全站 head 默认设置</div>
            <div className="text-xs text-wt-muted leading-relaxed mb-4">
              一次性应用到全部 <span className="text-wt-text font-medium">{pages.length}</span> 个页面，直接写入各页
              <span className="font-mono text-wt-text"> {'<head>'}</span>。所有输入项
              <span className="text-wt-text"> 留空即不改动</span>；单页微调仍可用「页面设置」。
            </div>

            {/* 标题模式 */}
            <div className="mb-4">
              <div className={labelCls}>页面标题 title</div>
              <div className="flex gap-1.5 mb-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setTitleMode(m.value)}
                    title={m.hint}
                    className={`flex-1 px-2 py-1.5 text-[11px] rounded border transition-colors ${
                      titleMode === m.value
                        ? 'border-wt-primary/60 text-wt-text bg-wt-primary/10'
                        : 'border-wt-border text-wt-muted hover:text-wt-text hover:bg-wt-surface-2'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {titleMode !== 'keep' && (
                <input
                  value={titleText}
                  onChange={(e) => setTitleText(e.target.value)}
                  placeholder={titleMode === 'replace' ? '所有页面统一使用的标题' : '追加的后缀，如「 - Acme 官网」'}
                  spellCheck={false}
                  className={inputCls}
                />
              )}
            </div>

            {/* favicon */}
            <div className="mb-4">
              <div className={labelCls}>网站图标 favicon（全站统一）</div>
              <div className="flex items-center gap-2">
                <input
                  value={favicon}
                  onChange={(e) => setFavicon(e.target.value)}
                  placeholder="站点根相对路径（如 assets/favicon.svg）或 http(s) 链接；留空不改动"
                  spellCheck={false}
                  className={monoInputCls}
                />
                <button
                  onClick={() => handlePick('favicon')}
                  disabled={picking !== null || !currentTemplate}
                  className="flex-shrink-0 text-[11px] px-2.5 py-1.5 rounded border border-wt-border text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors disabled:opacity-40"
                >
                  {picking === 'favicon' ? '选择中…' : '选择图片'}
                </button>
              </div>
              <div className="text-[10px] text-wt-muted/70 mt-1">
                子目录页面会自动换算为 ../ 相对路径
              </div>
            </div>

            {/* description */}
            <label className="block mb-4">
              <div className={labelCls}>页面描述 description（全站统一）</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="填了就覆盖所有页面的描述；留空保持各页现有描述"
                rows={2}
                spellCheck={false}
                className={`${inputCls} resize-none`}
              />
            </label>

            {/* Open Graph */}
            <div className="border border-wt-border rounded-md p-3 mb-5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={ogEnabled}
                  onChange={(e) => setOgEnabled(e.target.checked)}
                  className="accent-wt-primary"
                />
                <span className="text-xs text-wt-text">
                  添加 / 更新社交分享标签（Open Graph）
                </span>
              </label>
              {ogEnabled && (
                <div className="mt-3 space-y-3">
                  <input
                    value={ogTitle}
                    onChange={(e) => setOgTitle(e.target.value)}
                    placeholder="og:title；留空自动跟随各页最终标题"
                    spellCheck={false}
                    className={inputCls}
                  />
                  <textarea
                    value={ogDescription}
                    onChange={(e) => setOgDescription(e.target.value)}
                    placeholder="og:description；留空自动跟随各页描述"
                    rows={2}
                    spellCheck={false}
                    className={`${inputCls} resize-none`}
                  />
                  <div className="flex items-center gap-2">
                    <input
                      value={ogImage}
                      onChange={(e) => setOgImage(e.target.value)}
                      placeholder="og:image 分享封面，如 assets/og-cover.jpg"
                      spellCheck={false}
                      className={monoInputCls}
                    />
                    <button
                      onClick={() => handlePick('og')}
                      disabled={picking !== null || !currentTemplate}
                      className="flex-shrink-0 text-[11px] px-2.5 py-1.5 rounded border border-wt-border text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors disabled:opacity-40"
                    >
                      {picking === 'og' ? '选择中…' : '选择图片'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded-md text-wt-muted hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleApply}
                disabled={saving || !currentTemplate || !canApply}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-wt-primary hover:bg-wt-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? '应用中…' : `应用到全部 ${pages.length} 个页面`}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
