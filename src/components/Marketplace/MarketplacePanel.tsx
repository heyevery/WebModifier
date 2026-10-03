// src/components/Marketplace/MarketplacePanel.tsx
// 模板市场：浏览只读的内置模板，点击「使用模板」会复制一份到用户模板库并打开编辑。

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import type { MarketTemplateMeta } from '@shared/types/ipc';

export function MarketplacePanel() {
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const openTemplate = useTemplateStore((s) => s.openTemplate);
  const setActivePanel = useTemplateStore((s) => s.setActivePanel);

  const [items, setItems] = useState<MarketTemplateMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');
  const [usingName, setUsingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await window.wt.listMarketTemplates();
      setItems(res.templates);
    } catch (e) {
      setError(`加载模板市场失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((t) => set.add(t.category || '其他'));
    return ['全部', ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items.filter((t) => {
      if (category !== '全部' && t.category !== category) return false;
      if (!kw) return true;
      return (
        t.title.toLowerCase().includes(kw) ||
        t.description.toLowerCase().includes(kw) ||
        t.tags.some((tag) => tag.toLowerCase().includes(kw))
      );
    });
  }, [items, keyword, category]);

  // 使用市场模板：复制为用户模板 → 刷新列表 → 打开 → 跳转资源管理器
  async function handleUse(t: MarketTemplateMeta): Promise<void> {
    if (usingName) return;
    setUsingName(t.name);
    setError(null);
    try {
      const res = await window.wt.useMarketTemplate({ name: t.name });
      await fetchTemplates();
      await openTemplate(res.name);
      setActivePanel('explorer');
    } catch (e) {
      setError(`使用模板失败：${String(e)}`);
    } finally {
      setUsingName(null);
    }
  }

  return (
    <aside className="relative w-full h-full bg-wt-surface border-r border-wt-border flex flex-col">
      {/* 头部 */}
      <div className="px-3 py-2 border-b border-wt-border flex items-center justify-between">
        <div>
          <div className="text-[10px] text-wt-muted uppercase tracking-[0.15em]">模板市场</div>
          <div className="text-[10px] text-wt-muted mt-0.5">点击「使用模板」创建你的副本</div>
        </div>
        <button
          onClick={() => void reload()}
          className="text-[10px] px-2 py-0.5 rounded text-wt-muted border border-wt-border hover:text-wt-text hover:bg-wt-surface-2 transition-colors"
          title="重新加载市场列表"
        >
          刷新
        </button>
      </div>

      {/* 搜索 */}
      <div className="px-2.5 py-2 border-b border-wt-border">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索模板名称 / 标签"
          className="w-full bg-wt-bg border border-wt-border rounded px-2 py-1.5 text-[11px] text-wt-text
                     placeholder:text-wt-muted/60 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
        />
        <div className="flex flex-wrap gap-1 mt-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                category === c
                  ? 'bg-wt-primary/20 text-wt-primary'
                  : 'bg-wt-surface-2 text-wt-muted hover:text-wt-text'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 模板卡片列表 */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {loading ? (
          <div className="text-wt-muted text-[11px] px-1 py-4 animate-pulse-soft">正在加载模板市场…</div>
        ) : (
          <>
            {filtered.map((t, i) => {
              const busy = usingName === t.name;
              return (
                <motion.div
                  key={t.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.3) }}
                  className="group rounded-lg border border-wt-border bg-wt-surface-2/50 overflow-hidden
                             hover:border-wt-primary/40 transition-colors"
                >
                  <div className="p-3">
                    <div className="flex items-start gap-2.5">
                      <span className="w-10 h-10 flex-shrink-0 rounded-lg bg-gradient-to-br from-wt-primary/25 to-wt-accent/20 flex items-center justify-center text-xl">
                        {t.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-wt-text truncate">{t.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-wt-muted">
                          <span className="px-1 py-px rounded bg-wt-surface text-wt-accent">{t.category}</span>
                          <span>{t.pageCount} 页</span>
                          <span>·</span>
                          <span>{t.regionCount} 处可编辑</span>
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-[10.5px] leading-relaxed text-wt-muted line-clamp-2">
                      {t.description}
                    </p>
                    {t.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {t.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[9px] px-1 py-px rounded bg-wt-surface text-wt-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => void handleUse(t)}
                      disabled={busy || usingName !== null}
                      className="mt-2.5 w-full py-1.5 text-[11px] font-medium rounded-md bg-wt-primary/15 text-wt-primary
                                 hover:bg-wt-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy ? '正在创建副本…' : '使用此模板'}
                    </button>
                  </div>
                </motion.div>
              );
            })}

            {!loading && filtered.length === 0 && (
              <div className="text-wt-muted text-[11px] px-1 py-6 text-center leading-relaxed">
                没有匹配的模板
                <br />
                换个关键词或分类试试。
              </div>
            )}
          </>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="px-2 py-1.5 rounded bg-wt-danger/10 border border-wt-danger/30 text-[10px] text-wt-danger leading-relaxed"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </aside>
  );
}
