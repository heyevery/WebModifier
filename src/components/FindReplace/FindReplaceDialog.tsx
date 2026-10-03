// src/components/FindReplace/FindReplaceDialog.tsx
// 全局查找替换：在全部页面的可编辑文字区域中查找（实时预览，按页分组），
// 一键全部替换。只改可编辑区域内容，不碰模板原始 HTML 与文件路径。

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import { findInRegions, type RegionMatch } from '@shared/find-replace';
import { toast } from '@/components/Toast/toast';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 把片段中的命中部分加粗（大小写不敏感定位） */
function Highlight({ text, query, caseSensitive }: { text: string; query: string; caseSensitive: boolean }) {
  if (!query) return <>{text}</>;
  const lower = caseSensitive ? text : text.toLowerCase();
  const q = caseSensitive ? query : query.toLowerCase();
  const parts: { seg: string; hit: boolean }[] = [];
  let i = 0;
  for (;;) {
    const idx = lower.indexOf(q, i);
    if (idx < 0) {
      parts.push({ seg: text.slice(i), hit: false });
      break;
    }
    if (idx > i) parts.push({ seg: text.slice(i, idx), hit: false });
    parts.push({ seg: text.slice(idx, idx + query.length), hit: true });
    i = idx + query.length;
  }
  return (
    <>
      {parts.map((p, k) =>
        p.hit ? (
          <mark key={k} className="bg-wt-warning/30 text-wt-text rounded-[2px] px-0.5">
            {p.seg}
          </mark>
        ) : (
          <span key={k}>{p.seg}</span>
        )
      )}
    </>
  );
}

export function FindReplaceDialog({ open, onClose }: Props) {
  const regionsByPage = useTemplateStore((s) => s.regionsByPage);
  const replaceAcrossPages = useTemplateStore((s) => s.replaceAcrossPages);

  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);

  const allRegions = useMemo(() => Object.values(regionsByPage).flat(), [regionsByPage]);
  const matches: RegionMatch[] = useMemo(
    () => findInRegions(allRegions, query, { caseSensitive }),
    [allRegions, query, caseSensitive]
  );
  const totalCount = matches.reduce((n, m) => n + m.count, 0);

  // 按页面分组（保持 regionsByPage 自身的页序）
  const grouped = useMemo(() => {
    const map = new Map<string, RegionMatch[]>();
    for (const m of matches) {
      const arr = map.get(m.page) ?? [];
      arr.push(m);
      map.set(m.page, arr);
    }
    return [...map.entries()];
  }, [matches]);

  function handleReplaceAll(): void {
    if (!query || totalCount === 0) return;
    const res = replaceAcrossPages(query, replacement, caseSensitive);
    if (res.totalCount > 0) {
      toast.success(`已在 ${res.pageCount} 个页面替换 ${res.totalCount} 处文字（可 Ctrl+Z 撤销）`);
    } else {
      toast.info('没有可替换的匹配');
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
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="w-[480px] max-w-[92vw] bg-wt-surface border border-wt-border rounded-xl shadow-2xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-wt-text">全局查找替换</h3>
              <span className="text-[11px] text-wt-muted">全部页面 · 仅可编辑文字区域</span>
            </div>

            <label className="block text-[11px] text-wt-muted mb-1">查找内容</label>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="要查找的文字，如公司名、电话号码…"
              spellCheck={false}
              className="w-full px-2.5 py-1.5 rounded-md bg-wt-bg border border-wt-border text-[13px]
                         text-wt-text focus:outline-none focus:border-wt-primary transition-colors"
            />

            <label className="block text-[11px] text-wt-muted mt-3 mb-1">替换为</label>
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleReplaceAll();
                if (e.key === 'Escape') onClose();
              }}
              placeholder="替换后的文字（可留空，用于删除匹配文字）"
              spellCheck={false}
              className="w-full px-2.5 py-1.5 rounded-md bg-wt-bg border border-wt-border text-[13px]
                         text-wt-text focus:outline-none focus:border-wt-primary transition-colors"
            />

            <div className="mt-2.5 flex items-center justify-between">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  className="w-3.5 h-3.5 accent-wt-primary"
                />
                <span className="text-[11px] text-wt-muted">区分大小写</span>
              </label>
              <span className="text-[11px] text-wt-muted">
                {query ? (
                  totalCount > 0 ? (
                    <>
                      共 <span className="text-wt-text font-medium">{totalCount}</span> 处 ·{' '}
                      {matches.length} 个区域 · {grouped.length} 个页面
                    </>
                  ) : (
                    '无匹配'
                  )
                ) : (
                  '输入内容开始查找'
                )}
              </span>
            </div>

            {/* 匹配预览 */}
            {query && grouped.length > 0 && (
              <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-wt-border bg-wt-bg">
                {grouped.map(([page, items]) => (
                  <div key={page}>
                    <div className="sticky top-0 px-2.5 py-1 text-[10px] font-mono text-wt-muted
                                    bg-wt-surface-2 border-b border-wt-border flex justify-between">
                      <span>{page}</span>
                      <span>{items.reduce((n, m) => n + m.count, 0)} 处</span>
                    </div>
                    <ul className="px-2.5 py-1 flex flex-col gap-1">
                      {items.map((m) => (
                        <li key={m.regionId} className="text-[11px] leading-snug flex items-start gap-2 py-0.5">
                          <span className="flex-shrink-0 px-1 py-px rounded bg-wt-primary/15 text-wt-primary font-mono text-[10px] mt-px">
                            {m.type}
                          </span>
                          <span className="flex-1 text-wt-text break-words">
                            <Highlight text={m.snippet} query={query} caseSensitive={caseSensitive} />
                          </span>
                          <span className="flex-shrink-0 text-[10px] text-wt-muted mt-px">{m.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-[13px] rounded-md text-wt-muted hover:text-wt-text
                           hover:bg-wt-surface-2 transition-colors"
              >
                关闭
              </button>
              <button
                onClick={handleReplaceAll}
                disabled={totalCount === 0}
                className="px-4 py-1.5 text-[13px] font-medium rounded-md bg-wt-primary
                           hover:bg-wt-primary-hover text-white transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                全部替换{totalCount > 0 ? `（${totalCount}）` : ''}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
