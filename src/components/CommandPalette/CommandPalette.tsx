// src/components/CommandPalette/CommandPalette.tsx
// VSCode 风格命令面板 / 快速打开：
//   Ctrl+Shift+P → 命令；Ctrl+P → 当前工作区页面快速切换

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTemplateStore, type SidebarPanel } from '@/store/template-store';
import { emitIntent } from '@/lib/intents';
import { manualCheckForUpdates } from '@/components/Updater/UpdateIndicator';

type PaletteMode = 'commands' | 'pages';

/** 外部 UI（搜索框/按钮）唤起命令面板的事件 */
export const PALETTE_EVENT = 'wt-open-palette';

/** 以指定模式打开命令面板（供面包屑搜索框、主页等入口调用） */
export function openPalette(mode: PaletteMode = 'commands'): void {
  window.dispatchEvent(new CustomEvent<PaletteMode>(PALETTE_EVENT, { detail: mode }));
}

/** 子序列模糊匹配：返回分数（越大越靠前），不匹配返回 null */
function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    let bonus = 1;
    if (ti === 0) bonus = 10;
    else if ('/_-. 　'.includes(t[ti - 1])) bonus = 7;
    else if (lastIdx === ti - 1) bonus = 3;
    score += bonus;
    lastIdx = ti;
    qi++;
  }
  return qi === q.length ? score : null;
}

interface CommandDef {
  id: string;
  label: string;
  hint?: string;
  kbd?: string;
  requiresTemplate?: boolean;
  run: () => void;
}

const VIEWPORT_EVENT = 'wt-viewport-change';

function setViewport(mode: 'desktop' | 'tablet' | 'phone'): void {
  try {
    window.localStorage.setItem('wt-viewport-mode', mode);
  } catch {
    // 隐私模式忽略
  }
  window.dispatchEvent(new CustomEvent(VIEWPORT_EVENT, { detail: mode }));
}

export function CommandPalette() {
  const [mode, setMode] = useState<PaletteMode | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pages = useTemplateStore((s) => s.pages);
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const openTab = useTemplateStore((s) => s.openTab);
  const setActivePanel = useTemplateStore((s) => s.setActivePanel);
  const toggleSidebar = useTemplateStore((s) => s.toggleSidebar);

  const open = useCallback((m: PaletteMode) => {
    setMode(m);
    setQuery('');
    setActive(0);
  }, []);

  const close = useCallback(() => setMode(null), []);

  // 全局唤起：Ctrl+Shift+P 命令，Ctrl+P 页面；也响应 UI 入口发来的事件
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'p') {
        e.preventDefault();
        open(e.shiftKey ? 'commands' : 'pages');
      }
    };
    const onEvent = (e: Event): void => open((e as CustomEvent<PaletteMode>).detail || 'commands');
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_EVENT, onEvent);
    };
  }, [open]);

  // 打开后聚焦输入框
  useEffect(() => {
    if (mode) inputRef.current?.focus();
  }, [mode]);

  const commands = useMemo<CommandDef[]>(() => {
    const panelCmd = (panel: SidebarPanel, label: string): CommandDef => ({
      id: `panel:${panel}`,
      label: `视图：${label}`,
      run: () => setActivePanel(panel)
    });
    const list: CommandDef[] = [
      {
        id: 'go:pages',
        label: '转到页面…',
        kbd: 'Ctrl+P',
        requiresTemplate: true,
        run: () => open('pages')
      },
      { id: 'view:sidebar', label: '视图：切换侧边栏', kbd: 'Ctrl+B', run: toggleSidebar },
      panelCmd('explorer', '资源管理器'),
      panelCmd('styles', '样式面板'),
      panelCmd('theme', '主题变量面板'),
      panelCmd('history', '历史面板'),
      panelCmd('marketplace', '模板市场'),
      {
        id: 'view:desktop',
        label: '预览宽度：桌面（100%）',
        requiresTemplate: true,
        run: () => setViewport('desktop')
      },
      {
        id: 'view:tablet',
        label: '预览宽度：平板（768px）',
        requiresTemplate: true,
        run: () => setViewport('tablet')
      },
      {
        id: 'view:phone',
        label: '预览宽度：手机（390px）',
        requiresTemplate: true,
        run: () => setViewport('phone')
      },
      {
        id: 'project:save',
        label: '保存项目（保存所有页面修改）',
        kbd: 'Ctrl+S',
        requiresTemplate: true,
        run: () => emitIntent('save-project')
      },
      {
        id: 'project:export',
        label: '导出为静态网站…',
        requiresTemplate: true,
        run: () => emitIntent('export')
      },
      {
        id: 'page:settings',
        label: '页面设置（标题 / 描述 / 图标 / 语言）…',
        requiresTemplate: true,
        run: () => emitIntent('page-settings')
      },
      {
        id: 'site:code',
        label: '自定义代码（统计 / 客服脚本，全站注入）…',
        requiresTemplate: true,
        run: () => emitIntent('site-code')
      },
      {
        id: 'edit:find-replace',
        label: '全局查找替换（跨所有页面改公司名 / 电话）…',
        requiresTemplate: true,
        run: () => emitIntent('find-replace')
      },
      {
        id: 'site:head',
        label: '全站 head 设置（统一 favicon / 标题后缀 / 描述 / OG 分享标签）…',
        requiresTemplate: true,
        run: () => emitIntent('site-head')
      },
      {
        id: 'view:external-preview',
        label: '在外部浏览器中预览当前网站',
        requiresTemplate: true,
        run: () => emitIntent('external-preview')
      },
      {
        id: 'template:restore',
        label: '恢复模板到原始状态…',
        requiresTemplate: true,
        run: () => emitIntent('restore-template')
      },
      {
        id: 'workspace:new',
        label: '新建空白工作区…',
        run: () => emitIntent('new-workspace')
      },
      {
        id: 'template:import',
        label: '导入 HTML 文件或模板文件夹…',
        run: () => emitIntent('import-template')
      },
      {
        id: 'page:import',
        label: '把其他模板导入为新页面…',
        requiresTemplate: true,
        run: () => emitIntent('new-page')
      },
      {
        id: 'app:check-update',
        label: '检查应用更新…',
        run: () => void manualCheckForUpdates()
      }
    ];
    return list.filter((c) => !c.requiresTemplate || currentTemplate);
  }, [currentTemplate, open, setActivePanel, toggleSidebar]);

  const pageItems = useMemo(() => {
    const q = query.trim();
    return pages
      .map((p) => {
        const base = p.split('/').pop() ?? p;
        const score = fuzzyScore(q, `${base} ${p}`);
        return score === null ? null : { page: p, base, score };
      })
      .filter((x): x is { page: string; base: string; score: number } => x !== null)
      .sort((a, b) => b.score - a.score);
  }, [pages, query]);

  const commandItems = useMemo(() => {
    const q = query.replace(/^>/, '').trim();
    return commands
      .map((c) => ({ cmd: c, score: fuzzyScore(q, c.label) }))
      .filter((x): x is { cmd: CommandDef; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score);
  }, [commands, query]);

  const items = mode === 'pages' ? pageItems : commandItems;

  // 过滤结果变化后把高亮限制在范围内
  useEffect(() => {
    setActive((i) => (items.length === 0 ? 0 : Math.min(i, items.length - 1)));
  }, [items.length]);

  const runActive = (): void => {
    const item = items[active];
    if (!item) return;
    close();
    if (mode === 'pages' && 'page' in item) openTab(item.page);
    if (mode === 'commands' && 'cmd' in item) item.cmd.run();
  };

  const onInputKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    }
  };

  // 高亮项滚动到可见区域
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!mode) return null;

  return (
    <div
      className="fixed inset-0 z-[100]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="absolute left-1/2 -translate-x-1/2 top-[64px] w-[600px] max-w-[92vw]
                   bg-wt-surface border border-wt-border-strong rounded-md shadow-wt-lg overflow-hidden"
      >
        <div className="flex items-center border-b border-wt-border">
          <span className="pl-3 text-[11px] text-wt-muted font-mono select-none">
            {mode === 'commands' ? '>' : ''}
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            spellCheck={false}
            placeholder={mode === 'commands' ? '键入要执行的命令名称' : '输入页面名快速打开'}
            className="flex-1 h-9 bg-transparent px-2 text-[13px] text-wt-text outline-none
                       placeholder:text-wt-muted/70"
          />
          <span className="pr-3 text-[10px] text-wt-muted/70 select-none">Esc 关闭</span>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1">
          {mode === 'pages' && pageItems.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-wt-muted">
              {currentTemplate ? '没有匹配的页面' : '请先打开一个工作区'}
            </div>
          )}
          {mode === 'commands' && commandItems.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-wt-muted">没有匹配的命令</div>
          )}

          {mode === 'pages' &&
            pageItems.map((item, i) => (
              <button
                key={item.page}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={runActive}
                className={`w-full flex items-center gap-2 h-[26px] px-3 text-left text-[13px]
                            ${i === active ? 'bg-wt-selection text-wt-text-bright' : 'text-wt-text'}`}
              >
                <span className="font-mono text-[11px] opacity-70 w-4 flex-shrink-0">html</span>
                <span className="truncate">{item.base}</span>
                <span className="ml-auto truncate text-[11px] opacity-60 font-mono">
                  {item.page}
                </span>
              </button>
            ))}

          {mode === 'commands' &&
            commandItems.map((item, i) => (
              <button
                key={item.cmd.id}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={runActive}
                className={`w-full flex items-center gap-2 h-[26px] px-3 text-left text-[13px]
                            ${i === active ? 'bg-wt-selection text-wt-text-bright' : 'text-wt-text'}`}
              >
                <span className="truncate">{item.cmd.label}</span>
                {item.cmd.kbd && (
                  <span className="ml-auto pl-4 text-[11px] font-mono opacity-60 whitespace-nowrap">
                    {item.cmd.kbd}
                  </span>
                )}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
