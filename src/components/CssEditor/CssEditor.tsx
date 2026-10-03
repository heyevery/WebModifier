// src/components/CssEditor/CssEditor.tsx
// CSS 可视化编辑面板：左侧文件列表 + 选择器列表，右侧属性键值对编辑
// 修改实时通过 iframe postMessage 预览；差异保存在会话/草稿中（模板本体不动），导出时覆盖导出副本
// 点击页面组件时自动定位该组件匹配的 CSS 规则

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import type { CssBlock, CssDeclaration } from '@shared/css-utils';
import { CssValueField, PROPERTY_LABELS, KNOWN_PROPERTIES } from './CssValueField';

/* ---------------- 常用属性预设（小白友好，点击即可用） ---------------- */
// 每个预设都带有可用的默认值，添加后自动进入可视化控件（颜色/滑块/下拉/数字）。
const PROPERTY_PRESETS: { group: string; items: { property: string; value: string }[] }[] = [
  {
    group: '背景',
    items: [
      { property: 'background-color', value: '#ffffff' },
      { property: 'background-image', value: "url('图片地址')" },
      { property: 'background-size', value: 'cover' },
      { property: 'background-repeat', value: 'no-repeat' }
    ]
  },
  {
    group: '文字',
    items: [
      { property: 'color', value: '#333333' },
      { property: 'font-size', value: '16px' },
      { property: 'font-weight', value: '400' },
      { property: 'text-align', value: 'left' },
      { property: 'line-height', value: '1.6' }
    ]
  },
  {
    group: '布局',
    items: [
      { property: 'display', value: 'flex' },
      { property: 'flex-direction', value: 'row' },
      { property: 'justify-content', value: 'center' },
      { property: 'align-items', value: 'center' },
      { property: 'gap', value: '12px' },
      { property: 'position', value: 'relative' }
    ]
  },
  {
    group: '间距尺寸',
    items: [
      { property: 'padding', value: '16px' },
      { property: 'margin', value: '0' },
      { property: 'width', value: '100%' },
      { property: 'height', value: 'auto' }
    ]
  },
  {
    group: '边框圆角',
    items: [
      { property: 'border-width', value: '1px' },
      { property: 'border-style', value: 'solid' },
      { property: 'border-color', value: '#dddddd' },
      { property: 'border-radius', value: '8px' }
    ]
  },
  {
    group: '效果',
    items: [
      { property: 'opacity', value: '1' },
      { property: 'cursor', value: 'pointer' },
      { property: 'box-shadow', value: '0 2px 8px rgba(0, 0, 0, 0.15)' }
    ]
  }
];

/**
 * 计算 CSS 选择器特异性（近似值，覆盖模板中常见的 class/id/标签/伪类写法）。
 * 逗号分组取最高分；通配 * 得 0 分——这正是点击组件时不能直接选第一条命中规则的原因：
 * 几乎所有模板首条都是 *，它永远 matches 成功但优先级最低。
 */
function selectorSpecificity(selector: string): number {
  let best = 0;
  for (const rawPart of selector.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const ids = part.match(/#[\w-]+/g)?.length ?? 0;
    const classes = part.match(/\.[\w-]+/g)?.length ?? 0;
    const attrs = part.match(/\[[^\]]*\]/g)?.length ?? 0;
    // 伪类（含带参形式 :nth-child(2n+1)）；::伪元素单独统计
    const pseudoClasses = part.match(/(^|[^:]):[a-zA-Z-]+(?:\([^)]*\))?/g)?.length ?? 0;
    const pseudoEls = part.match(/::[a-zA-Z-]+/g)?.length ?? 0;
    // 剥离上述成分后，剩余的单词即类型选择器
    const stripped = part
      .replace(/#[\w-]+/g, ' ')
      .replace(/\.[\w-]+/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/::?[a-zA-Z-]+(?:\([^)]*\))?/g, ' ');
    const types = stripped.match(/[a-zA-Z][\w-]*/g)?.length ?? 0;
    const score = ids * 100 + (classes + attrs + pseudoClasses) * 10 + types + pseudoEls;
    if (score > best) best = score;
  }
  return best;
}

export function CssEditor() {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const cssFiles = useTemplateStore((s) => s.cssFiles);
  const cssCurrentFile = useTemplateStore((s) => s.cssCurrentFile);
  const cssBlocks = useTemplateStore((s) => s.cssBlocks);
  const cssOverrides = useTemplateStore((s) => s.cssOverrides);
  const iframeApi = useTemplateStore((s) => s.iframeApi);
  const selectedRid = useTemplateStore((s) => s.selectedRid);
  const loadCssFile = useTemplateStore((s) => s.loadCssFile);
  const saveCssFile = useTemplateStore((s) => s.saveCssFile);
  const restoreCssFile = useTemplateStore((s) => s.restoreCssFile);
  const updateCssBlock = useTemplateStore((s) => s.updateCssBlock);
  const addCssBlock = useTemplateStore((s) => s.addCssBlock);
  const removeCssBlock = useTemplateStore((s) => s.removeCssBlock);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [newSelector, setNewSelector] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // 被切换为「代码模式」的属性序号（按当前规则内序号）
  const [rawOverrides, setRawOverrides] = useState<Set<number>>(new Set());
  // 当前页面选中组件命中的规则 block 索引集合（小圆点提示）
  const [matchedBlocks, setMatchedBlocks] = useState<Set<number>>(new Set());
  const [noMatchHint, setNoMatchHint] = useState(false);
  // 常用属性预设面板展开状态
  const [presetOpen, setPresetOpen] = useState(true);
  const reqIdRef = useRef('');
  // requestId → 本次匹配是否允许自动定位规则
  // （仅「点击页面组件 / 切换 CSS 文件」为 true；编辑属性触发的重匹配只刷新小圆点）
  const autoSelectMap = useRef(new Map<string, boolean>());
  const ruleRefs = useRef(new Map<number, HTMLElement>());

  // 仅普通规则（可编辑），注释与 at 规则在列表中隐藏但保存时保留
  const rules = useMemo(
    () =>
      cssBlocks
        .map((b, index) => ({ block: b, index }))
        .filter((x): x is { block: Extract<CssBlock, { kind: 'rule' }>; index: number } => x.block.kind === 'rule'),
    [cssBlocks]
  );

  const selected =
    selectedIndex !== null && cssBlocks[selectedIndex]?.kind === 'rule'
      ? (cssBlocks[selectedIndex] as Extract<CssBlock, { kind: 'rule' }>)
      : null;

  // 切换规则/文件时清空代码模式覆盖标记
  useEffect(() => {
    setRawOverrides(new Set());
  }, [selectedIndex, cssCurrentFile]);

  // 选中规则时在页面上高亮对应元素（小白用户可直观看到该样式影响谁）
  useEffect(() => {
    iframeApi?.postMessage({ type: 'wt-css-highlight', selector: selected?.selector ?? '' });
  }, [iframeApi, selected?.selector]);

  // 组件卸载时清除高亮
  useEffect(() => {
    return () => {
      useTemplateStore.getState().iframeApi?.postMessage({ type: 'wt-css-highlight', selector: '' });
    };
  }, []);

  // 发起一次命中匹配。autoSelect=true 时（点击组件/切换文件）结果会自动定位到最具体规则；
  // autoSelect=false 时（编辑属性导致 cssBlocks 变化）仅刷新命中小圆点，绝不抢走当前选中规则
  function requestMatch(autoSelect: boolean) {
    const state = useTemplateStore.getState();
    const currentRules = state.cssBlocks
      .map((b, index) => ({ block: b, index }))
      .filter((x) => x.block.kind === 'rule');
    if (!state.selectedRid || !state.cssCurrentFile || currentRules.length === 0) {
      setMatchedBlocks(new Set());
      setNoMatchHint(false);
      return;
    }
    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    reqIdRef.current = reqId;
    autoSelectMap.current.set(reqId, autoSelect);
    const selectors = currentRules.map((r) => (r.block as { selector: string }).selector);
    state.iframeApi?.postMessage({
      type: 'wt-match-selectors',
      requestId: reqId,
      rid: state.selectedRid,
      selectors
    });
  }

  // 匹配请求统一入口：
  // - selectedRid / cssCurrentFile 变化（点击页面组件、切换 CSS 文件）→ 自动定位最具体规则
  // - cssBlocks 变化（编辑属性、增删规则）→ 仅刷新命中小圆点，不抢走当前选中规则
  const matchKeyRef = useRef('');
  useEffect(() => {
    const key = `${selectedRid}|${cssCurrentFile}`;
    const autoSelect = key !== matchKeyRef.current;
    matchKeyRef.current = key;
    requestMatch(autoSelect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRid, cssCurrentFile, cssBlocks, iframeApi]);

  // 接收 iframe 的匹配结果：自动定位时选择特异性最高的命中规则
  // （不能取第一条——模板首条通常是通配 *，它永远命中但特异性为 0）
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data;
      if (!msg || msg.type !== 'wt-matched-selectors') return;
      const autoSelect = autoSelectMap.current.get(msg.requestId) ?? false;
      autoSelectMap.current.delete(msg.requestId);
      if (msg.requestId !== reqIdRef.current) return;
      const currentRules = useTemplateStore
        .getState()
        .cssBlocks.map((b, index) => ({ block: b, index }))
        .filter((x) => x.block.kind === 'rule');
      const rawMatched: number[] = Array.isArray(msg.matched) ? msg.matched : [];
      const hits = rawMatched
        .map((i) => currentRules[i]?.index)
        .filter((v): v is number => typeof v === 'number');
      setMatchedBlocks(new Set(hits));
      if (hits.length > 0) {
        if (autoSelect) {
          const selectorOf = (idx: number): string =>
            (useTemplateStore.getState().cssBlocks[idx] as { selector?: string } | undefined)?.selector ?? '';
          // 特异性最高者胜出；同分时取后定义的规则（CSS 后者覆盖前者）
          const target = hits.reduce((best, idx) =>
            selectorSpecificity(selectorOf(idx)) > selectorSpecificity(selectorOf(best)) ? idx : best
          );
          setSelectedIndex(target);
          requestAnimationFrame(() => {
            ruleRefs.current.get(target)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
        setNoMatchHint(false);
      } else if (autoSelect) {
        setNoMatchHint(true);
        if (typeof msg.suggested === 'string' && msg.suggested) setNewSelector(msg.suggested);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 属性增删改
  function patchDecl(declIndex: number, patch: Partial<CssDeclaration>) {
    if (!selected || selectedIndex === null) return;
    const declarations = selected.declarations.map((d, i) => (i === declIndex ? { ...d, ...patch } : d));
    updateCssBlock(selectedIndex, { ...selected, declarations });
  }

  function addDecl() {
    if (!selected || selectedIndex === null) return;
    updateCssBlock(selectedIndex, {
      ...selected,
      declarations: [...selected.declarations, { property: '', value: '' }]
    });
  }

  /** 一键添加常用属性（带默认值，去重），添加后直接由可视化控件接管编辑 */
  function addPreset(property: string, value: string) {
    if (!selected || selectedIndex === null) return;
    const exists = selected.declarations.some((d) => d.property.trim().toLowerCase() === property);
    if (exists) return;
    updateCssBlock(selectedIndex, {
      ...selected,
      declarations: [...selected.declarations, { property, value }]
    });
  }

  function removeDecl(declIndex: number) {
    if (!selected || selectedIndex === null) return;
    const declarations = selected.declarations.filter((_, i) => i !== declIndex);
    updateCssBlock(selectedIndex, { ...selected, declarations });
  }

  /** 切换某条属性的「可视化 / 代码」编辑模式 */
  function toggleRaw(declIndex: number) {
    setRawOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(declIndex)) next.delete(declIndex);
      else next.add(declIndex);
      return next;
    });
  }

  function addRule() {
    const selector = newSelector.trim();
    if (!selector) return;
    addCssBlock({ kind: 'rule', selector, declarations: [] });
    setSelectedIndex(cssBlocks.length);
    setNewSelector('');
    setNoMatchHint(false);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await saveCssFile();
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore() {
    if (restoring) return;
    setRestoring(true);
    try {
      await restoreCssFile();
      setSelectedIndex(null);
      setRawOverrides(new Set());
    } finally {
      setRestoring(false);
    }
  }

  return (
    <aside className="w-full h-full bg-wt-surface border-r border-wt-border flex flex-col">
      <div className="px-3 py-2 border-b border-wt-border flex items-center justify-between">
        <div className="text-[10px] text-wt-muted uppercase tracking-[0.15em]">样式</div>
        {cssCurrentFile && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded text-wt-muted border border-wt-border hover:text-wt-text hover:bg-wt-surface-2 transition-colors disabled:opacity-50"
              title="放弃当前 CSS 文件的未保存修改，恢复为模板原始样式"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              {restoring ? '恢复中…' : '恢复原状'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-[10px] px-2 py-0.5 rounded bg-wt-primary/15 text-wt-primary hover:bg-wt-primary/25 transition-colors disabled:opacity-50"
              title="立即写入项目自动草稿（编辑时也会自动保存）；模板原件不会被改动，导出时自动使用这些样式"
            >
              {saving ? '保存中…' : '保存到草稿'}
            </button>
          </div>
        )}
      </div>

      {!currentTemplate ? (
        <div className="text-wt-muted text-xs px-3 py-4">请先打开一个模板。</div>
      ) : (
        <>
          {/* CSS 文件列表 */}
          <div className="px-2 py-1.5 border-b border-wt-border">
            <div className="text-[9px] text-wt-muted uppercase mb-1 px-1">CSS 文件</div>
            {cssFiles.length > 0 ? (
              <div className="space-y-0.5 max-h-[140px] overflow-y-auto">
                {cssFiles.map((f) => {
                  const modified = Object.prototype.hasOwnProperty.call(cssOverrides, f);
                  return (
                    <button
                      key={f}
                      onClick={() => {
                        setSelectedIndex(null);
                        loadCssFile(f);
                      }}
                      className={`w-full flex items-center gap-1 text-left px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                        cssCurrentFile === f
                          ? 'bg-wt-primary/15 text-wt-primary'
                          : 'text-wt-muted hover:bg-wt-surface-2 hover:text-wt-text'
                      }`}
                    >
                      <span
                        className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${
                          modified ? 'bg-wt-warning' : 'bg-transparent'
                        }`}
                        title={modified ? '该文件有未保存到模板的样式修改（保存在草稿中）' : undefined}
                      />
                      <span className="truncate">{f}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-wt-muted text-[11px] px-2 py-1">模板中没有 CSS 文件</div>
            )}
          </div>

          {/* 选择器列表 */}
          {cssCurrentFile && (
            <div className="px-2 py-1.5 border-b border-wt-border flex flex-col min-h-0">
              <div className="text-[9px] text-wt-muted uppercase mb-1 px-1 flex items-center justify-between">
                <span>选择器</span>
                <span className="text-[9px] text-wt-muted">{rules.length} 条</span>
              </div>

              {/* 添加规则 */}
              <div className="flex gap-1 px-1 mb-1.5">
                <input
                  value={newSelector}
                  onChange={(e) => setNewSelector(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRule()}
                  placeholder=".new-class"
                  className="flex-1 min-w-0 bg-wt-bg border border-wt-border rounded px-1.5 py-1 text-[11px] font-mono text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
                />
                <button
                  onClick={addRule}
                  disabled={!newSelector.trim()}
                  className="px-2 py-1 text-[10px] rounded bg-wt-primary/15 text-wt-primary hover:bg-wt-primary/25 transition-colors disabled:opacity-40"
                >
                  ＋
                </button>
              </div>

              {/* 点击页面组件但无对应规则时的提示 */}
              <AnimatePresence>
                {noMatchHint && selectedRid && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mx-1 mb-1.5"
                  >
                    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-wt-warning/10 border border-wt-warning/30 text-[10px] text-wt-warning leading-relaxed">
                      <span className="flex-shrink-0">💡</span>
                      <span>
                        该组件暂无样式规则，已自动填好选择器，点 <b>＋</b> 即可为它新建样式。
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-0.5 overflow-y-auto max-h-[200px]">
                <AnimatePresence initial={false}>
                  {rules.map(({ block, index }) => {
                    const isMatched = matchedBlocks.has(index);
                    return (
                    <motion.div
                      key={`${index}-${block.selector}`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 6 }}
                      transition={{ duration: 0.12 }}
                      className={`group flex items-center gap-1 rounded px-1 ${
                        selectedIndex === index
                          ? 'bg-wt-primary/15'
                          : isMatched
                            ? 'bg-wt-accent/10'
                            : 'hover:bg-wt-surface-2'
                      }`}
                    >
                      {isMatched && (
                        <span
                          className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-wt-accent"
                          title="当前选中组件匹配此规则"
                        />
                      )}
                      <button
                        ref={(el) => {
                          if (el) ruleRefs.current.set(index, el);
                          else ruleRefs.current.delete(index);
                        }}
                        onClick={() => setSelectedIndex(index)}
                        className={`flex-1 min-w-0 text-left px-1 py-1 text-[11px] font-mono truncate transition-colors ${
                          selectedIndex === index
                            ? 'text-wt-primary'
                            : isMatched
                              ? 'text-wt-accent'
                              : 'text-wt-muted group-hover:text-wt-text'
                        }`}
                        title={block.selector}
                      >
                        {block.selector}
                      </button>
                      <button
                        onClick={() => {
                          removeCssBlock(index);
                          if (selectedIndex === index) setSelectedIndex(null);
                          else if (selectedIndex !== null && selectedIndex > index) setSelectedIndex(selectedIndex - 1);
                        }}
                        className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-wt-muted hover:text-wt-danger hover:bg-wt-surface transition-all flex-shrink-0"
                        title="删除规则"
                      >
                        ×
                      </button>
                    </motion.div>
                    );
                  })}
                </AnimatePresence>
                {rules.length === 0 && (
                  <div className="text-wt-muted text-[11px] px-2 py-1">无普通规则（注释 / @规则已保留）</div>
                )}
              </div>
            </div>
          )}

          {/* 属性编辑器 */}
          <div className="flex-1 overflow-y-auto px-2 py-1.5">
            {/* 属性名自动补全 */}
            <datalist id="wt-css-prop-list">
              {KNOWN_PROPERTIES.map((p) => (
                <option key={p} value={p}>
                  {PROPERTY_LABELS[p]}
                </option>
              ))}
            </datalist>
            {selected ? (
              <>
                <div className="text-[9px] text-wt-muted uppercase mb-1 px-1 truncate" title={selected.selector}>
                  属性 — {selected.selector}
                </div>

                {/* 常用属性快捷面板：点击即带默认值添加，随后用可视化控件调整 */}
                <div className="mb-1.5 rounded border border-wt-border/70 bg-wt-surface-2/40">
                  <button
                    onClick={() => setPresetOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-1.5 py-1 text-[10px] text-wt-muted hover:text-wt-text transition-colors"
                  >
                    <span>⚡ 快捷属性（点击添加）</span>
                    <span className={`transition-transform ${presetOpen ? 'rotate-90' : ''}`}>›</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {presetOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="px-1.5 pb-1.5 space-y-1">
                          {PROPERTY_PRESETS.map((g) => (
                            <div key={g.group}>
                              <div className="text-[9px] text-wt-muted/70 px-0.5 mb-0.5">{g.group}</div>
                              <div className="flex flex-wrap gap-1">
                                {g.items.map((it) => {
                                  const used = selected.declarations.some(
                                    (d) => d.property.trim().toLowerCase() === it.property
                                  );
                                  return (
                                    <button
                                      key={it.property}
                                      onClick={() => addPreset(it.property, it.value)}
                                      disabled={used}
                                      title={used ? `${it.property} 已存在` : `${it.property}: ${it.value}`}
                                      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                        used
                                          ? 'border-wt-border/40 text-wt-muted/40 cursor-default bg-transparent'
                                          : 'border-wt-border bg-wt-bg text-wt-muted hover:text-wt-primary hover:border-wt-primary/50'
                                      }`}
                                    >
                                      {used ? '✓ ' : '＋'}
                                      {PROPERTY_LABELS[it.property] ?? it.property}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="space-y-1">
                  <AnimatePresence initial={false}>
                    {selected.declarations.map((d, di) => {
                      const zhLabel = PROPERTY_LABELS[d.property.trim().toLowerCase()];
                      const isRaw = rawOverrides.has(di);
                      return (
                        <motion.div
                          key={di}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.12 }}
                          className="group rounded bg-wt-surface-2/40 border border-wt-border/60 px-1.5 py-1"
                        >
                          {/* 属性名 + 中文名 + 操作按钮 */}
                          <div className="flex items-center gap-1 mb-1">
                            <input
                              value={d.property}
                              onChange={(e) => patchDecl(di, { property: e.target.value })}
                              list="wt-css-prop-list"
                              placeholder="属性名"
                              className="flex-1 min-w-0 bg-wt-bg border border-wt-border rounded px-1.5 py-0.5 text-[11px] font-mono text-wt-accent placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
                            />
                            {zhLabel && (
                              <span className="text-[9px] text-wt-muted flex-shrink-0" title={d.property}>
                                {zhLabel}
                              </span>
                            )}
                            <button
                              onClick={() => toggleRaw(di)}
                              className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-mono transition-all flex-shrink-0 ${
                                isRaw
                                  ? 'text-wt-primary bg-wt-primary/15'
                                  : 'text-wt-muted opacity-0 group-hover:opacity-100 hover:bg-wt-surface'
                              }`}
                              title={isRaw ? '切换为可视化编辑' : '切换为代码编辑'}
                            >
                              {'</>'}
                            </button>
                            <button
                              onClick={() => removeDecl(di)}
                              className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-wt-muted hover:text-wt-danger hover:bg-wt-surface transition-all flex-shrink-0"
                              title="删除属性"
                            >
                              ×
                            </button>
                          </div>
                          {/* 值：智能可视化控件（可随时切回原始代码） */}
                          {isRaw ? (
                            <input
                              value={d.value}
                              onChange={(e) => patchDecl(di, { value: e.target.value })}
                              placeholder="任意 CSS 值"
                              spellCheck={false}
                              className="w-full bg-wt-bg border border-wt-border rounded px-1.5 py-1 text-[11px] font-mono text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
                            />
                          ) : (
                            <CssValueField
                              property={d.property}
                              value={d.value}
                              onChange={(v) => patchDecl(di, { value: v })}
                            />
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
                <button
                  onClick={addDecl}
                  className="mt-1.5 w-full px-2 py-1 text-[11px] rounded border border-dashed border-wt-border text-wt-muted hover:text-wt-text hover:border-wt-primary/40 transition-colors"
                >
                  ＋ 添加属性
                </button>
                <p className="mt-1.5 px-1 text-[9px] text-wt-muted/70 leading-relaxed">
                  颜色、字号、对齐等常用属性会自动显示可视化控件；点击 {'</>'} 可输入任意 CSS 值。
                </p>
              </>
            ) : (
              <div className="text-wt-muted text-[11px] px-2 py-3 leading-relaxed">
                {cssCurrentFile ? '从上方选择一个规则进行编辑。' : '从上方选择一个 CSS 文件开始编辑。'}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
