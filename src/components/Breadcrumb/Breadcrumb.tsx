// src/components/Breadcrumb/Breadcrumb.tsx
// 编辑器面包屑：工作区名 › 页面路径分段（VSCode breadcrumb 风格）

import { useTemplateStore } from '@/store/template-store';
import { openPalette } from '@/components/CommandPalette/CommandPalette';

export function Breadcrumb() {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const currentPage = useTemplateStore((s) => s.currentPage);
  const pages = useTemplateStore((s) => s.pages);

  if (!currentTemplate || !currentPage || pages.length === 0) return null;

  const segments = currentPage.split('/');

  return (
    <div
      className="h-[22px] flex-shrink-0 flex items-center gap-1 px-3 bg-wt-bg border-b border-wt-border
                 text-[12px] text-wt-muted overflow-hidden whitespace-nowrap"
    >
      <span className="text-wt-muted/80">{currentTemplate}</span>
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-1 min-w-0">
            <span className="text-wt-muted/60">›</span>
            <span className={isLast ? 'text-wt-text truncate' : 'truncate'}>{seg}</span>
          </span>
        );
      })}

      {/* 命令面板可见入口：点击等同 Ctrl+Shift+P */}
      <button
        onClick={() => openPalette('commands')}
        title="显示命令面板（Ctrl+Shift+P）"
        className="ml-auto flex-shrink-0 h-[18px] flex items-center gap-1.5 px-2 rounded-sm
                   border border-wt-border bg-wt-surface text-wt-muted/80
                   hover:text-wt-text hover:border-wt-border-strong transition-colors"
      >
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="text-[10px]">搜索命令</span>
        <span className="text-[9px] font-mono opacity-60">⌃⇧P</span>
      </button>
    </div>
  );
}
