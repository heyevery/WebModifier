// src/components/Theme/ThemePanel.tsx
// 主题变量面板：聚合模板所有 CSS 文件里的自定义属性（:root / .dark / [data-theme]…），
// 颜色给取色器、其余给文本框；改值即写入该 CSS 文件的会话覆盖（cssOverrides），
// 实时预览、随草稿持久化、导出自动生效，模板磁盘不动。

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import type { ThemeVariable } from '@shared/css-variables';
import { groupThemeVariables, isDarkScope, variableKind, variableLabel } from '@shared/css-variables';

/** #hex 速判（取色器只支持 hex；其它颜色格式仍可通过文本框编辑） */
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const HEX3_RE = /^#[0-9a-fA-F]{3}$/;

function toHex6(value: string): string {
  const v = value.trim();
  if (HEX6_RE.test(v)) return v.toLowerCase();
  if (HEX3_RE.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return '#000000';
}

function VarColorControl({
  value,
  onCommit
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const hex = toHex6(value);
  const pickerReady = HEX6_RE.test(value.trim()) || HEX3_RE.test(value.trim());

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => pickerRef.current?.click()}
        className="relative w-7 h-7 rounded-md border border-wt-border flex-shrink-0 overflow-hidden shadow-sm hover:border-wt-primary/50 transition-colors"
        title="点击打开取色器"
        style={{
          backgroundColor: pickerReady ? hex : 'transparent',
          backgroundImage:
            'linear-gradient(45deg, #9aa0aa 25%, transparent 25%), linear-gradient(-45deg, #9aa0aa 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #9aa0aa 75%), linear-gradient(-45deg, transparent 75%, #9aa0aa 75%)',
          backgroundSize: '7px 7px',
          backgroundPosition: '0 0, 0 3.5px, 3.5px -3.5px, -3.5px 0'
        }}
      >
        {pickerReady && (
          <span className="block w-full h-full" style={{ backgroundColor: hex }} />
        )}
      </button>
      <input ref={pickerRef} type="color" className="hidden" value={hex}
        onChange={(e) => onCommit(e.target.value)}
      />
      <input
        value={text}
        spellCheck={false}
        placeholder="#ffffff / rgb(...) / red"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== value && onCommit(text.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setText(value); (e.target as HTMLInputElement).blur(); }
        }}
        className="flex-1 min-w-0 bg-wt-surface-2 border border-wt-border rounded px-1.5 py-1 text-[11px] font-mono text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
      />
    </div>
  );
}

function VarTextControl({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      spellCheck={false}
      placeholder="变量值…"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setText(value); (e.target as HTMLInputElement).blur(); }
      }}
      className="w-full bg-wt-surface-2 border border-wt-border rounded px-1.5 py-1 text-[11px] font-mono text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
    />
  );
}

function VarRow({ variable, multiFile }: { variable: ThemeVariable; multiFile: boolean }) {
  const updateThemeVariable = useTemplateStore((s) => s.updateThemeVariable);
  const resetThemeVariable = useTemplateStore((s) => s.resetThemeVariable);
  const kind = variableKind(variable.name, variable.value);
  const dirty = variable.inBaseline && variable.value !== variable.baselineValue;
  const dark = isDarkScope(variable.selector);

  const commit = (v: string) =>
    updateThemeVariable(variable.file, variable.blockIndex, variable.declIndex, v);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className="rounded-md border border-wt-border/70 bg-wt-surface-2/40 px-2 py-1.5"
    >
      <div className="flex items-center gap-1.5 mb-1 min-w-0">
        <span className="text-[11px] text-wt-text truncate" title={variable.name}>
          {variableLabel(variable.name)}
        </span>
        <span className="text-[9px] font-mono text-wt-muted/70 truncate flex-shrink-0">
          {variable.name}
        </span>
        {dark && (
          <span className="flex-shrink-0 px-1 py-px rounded text-[9px] bg-wt-surface-2 text-wt-muted border border-wt-border"
            title="该变量定义在深色主题作用域">
            深色
          </span>
        )}
        {dirty && (
          <button
            type="button"
            title={`恢复默认：${variable.baselineValue}`}
            onClick={() => resetThemeVariable(variable.file, variable.blockIndex, variable.declIndex)}
            className="flex-shrink-0 ml-auto text-[10px] px-1.5 py-0.5 rounded text-wt-muted border border-wt-border hover:text-wt-primary hover:border-wt-primary/50 hover:bg-wt-primary/10 transition-colors"
          >
            ↺ 重置
          </button>
        )}
      </div>
      {kind === 'color'
        ? <VarColorControl value={variable.value} onCommit={commit} />
        : <VarTextControl value={variable.value} onCommit={commit} />}
      <div className="text-[9px] text-wt-muted/60 mt-1 font-mono truncate"
        title={`${variable.file} → ${variable.selector}`}>
        {multiFile ? variable.file : variable.selector}
        {multiFile ? ` → ${variable.selector}` : ''}
        {dirty ? ` · 默认 ${variable.baselineValue}` : ''}
      </div>
    </motion.div>
  );
}

export function ThemePanel() {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const cssFiles = useTemplateStore((s) => s.cssFiles);
  const themeVars = useTemplateStore((s) => s.themeVars);
  const themeLoading = useTemplateStore((s) => s.themeLoading);
  const loadThemePanel = useTemplateStore((s) => s.loadThemePanel);
  const resetAllThemeVariables = useTemplateStore((s) => s.resetAllThemeVariables);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadThemePanel();
    // 面板挂载时加载一次；编辑都在本面板内完成并实时更新 themeVars
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTemplate]);

  const groups = useMemo(() => groupThemeVariables(themeVars), [themeVars]);
  const dirtyCount = themeVars.filter((v) => v.inBaseline && v.value !== v.baselineValue).length;
  const multiFile = cssFiles.length > 1;

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <aside className="w-full h-full bg-wt-surface border-r border-wt-border flex flex-col">
      <div className="px-3 py-2 border-b border-wt-border flex items-center justify-between">
        <div>
          <div className="text-[10px] text-wt-muted uppercase tracking-[0.15em]">主题</div>
          <div className="text-[10px] text-wt-muted/70 mt-0.5">
            {themeVars.length > 0 ? `${themeVars.length} 个变量` : 'CSS 自定义属性'}
          </div>
        </div>
        {dirtyCount > 0 && (
          <button
            type="button"
            onClick={resetAllThemeVariables}
            className="text-[10px] px-2 py-1 rounded border border-wt-border text-wt-muted hover:text-wt-primary hover:border-wt-primary/50 hover:bg-wt-primary/10 transition-colors"
            title="把所有改动过的变量恢复为模板默认值"
          >
            全部恢复默认{dirtyCount > 0 ? `（${dirtyCount}）` : ''}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-2">
        {!currentTemplate ? (
          <div className="text-wt-muted text-xs px-1 py-3">请先打开一个模板。</div>
        ) : themeLoading ? (
          <div className="text-wt-muted text-xs px-1 py-3">正在读取样式文件…</div>
        ) : themeVars.length === 0 ? (
          <div className="text-wt-muted text-[11px] leading-relaxed px-1 py-3 space-y-2">
            <p>该模板还没有定义可编辑的主题变量。</p>
            <p>
              可在 <span className="text-wt-text">样式</span> 面板的
              <span className="font-mono text-wt-text"> :root </span>
              规则中添加形如
              <span className="font-mono text-wt-text"> --brand: #c2410c; </span>
              的自定义属性，并在其它规则中用
              <span className="font-mono text-wt-text"> var(--brand) </span>
              引用，之后即可在这里一键换肤。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] text-wt-muted/70 leading-relaxed px-0.5">
              修改主题变量会实时作用于全站页面，随草稿保存并在导出时生效，模板原件不会被改动。
            </p>
            {groups.map((group) => {
              const open = !collapsed.has(group.key);
              const groupDirty = group.vars.filter(
                (v) => v.inBaseline && v.value !== v.baselineValue
              ).length;
              return (
                <div key={group.key}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center justify-between px-1 py-1 text-[10px] text-wt-muted hover:text-wt-text transition-colors"
                  >
                    <span className="flex items-center gap-1">
                      <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                      {group.title}
                      <span className="text-wt-muted/60">{group.vars.length}</span>
                    </span>
                    {groupDirty > 0 && (
                      <span className="text-wt-primary">{groupDirty} 项已改</span>
                    )}
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-1.5 pt-1 pb-1">
                          {group.vars.map((v) => (
                            <VarRow
                              key={`${v.file}:${v.blockIndex}:${v.declIndex}`}
                              variable={v}
                              multiFile={multiFile}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
