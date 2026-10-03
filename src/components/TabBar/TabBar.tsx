// src/components/TabBar/TabBar.tsx
// 顶部标签页栏：显示已打开的页面，支持切换/关闭（VSCode 风格）

import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function TabBar() {
  const openTabs = useTemplateStore((s) => s.openTabs);
  const activeTab = useTemplateStore((s) => s.activeTab);
  const dirtyTabs = useTemplateStore((s) => s.dirtyTabs);
  const setActiveTab = useTemplateStore((s) => s.setActiveTab);
  const closeTab = useTemplateStore((s) => s.closeTab);

  if (openTabs.length === 0) {
    return <div className="h-[35px] bg-wt-tabbar border-b border-wt-border flex-shrink-0" />;
  }

  return (
    <div className="h-[35px] bg-wt-tabbar border-b border-wt-border flex items-stretch overflow-x-auto flex-shrink-0
                    [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <AnimatePresence initial={false}>
        {openTabs.map((page) => {
          const isActive = page === activeTab;
          const dirty = !!dirtyTabs[page];
          return (
            <motion.div
              key={page}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, width: 0, transition: { duration: 0.15 } }}
              className={`group relative flex items-center gap-1.5 h-full pl-3 pr-2 border-r border-wt-border
                          cursor-pointer flex-shrink-0 min-w-0 max-w-[200px] transition-colors
                          ${isActive
                            ? 'bg-wt-tab-active text-wt-text'
                            : 'bg-wt-tab-inactive text-wt-muted hover:text-wt-text hover:bg-wt-tabbar'}`}
              onClick={() => setActiveTab(page)}
              title={page}
            >
              {/* 活动标签顶部 1px 强调线 */}
              {isActive && (
                <span className="absolute top-0 left-0 right-0 h-[1px] bg-wt-accent" />
              )}
              <span className="text-[13px] truncate">{basename(page)}</span>
              {/* 尾部槽位：未保存圆点 / 悬停或活动时常驻关闭按钮，两者切换不引起标签宽度抖动 */}
              <span className="relative w-4 h-4 flex-shrink-0">
                <span
                  className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                    dirty ? 'opacity-100 group-hover:opacity-0' : 'opacity-0'
                  }`}
                  title="有未保存修改"
                >
                  <span className="w-2 h-2 rounded-full bg-wt-text-bright" />
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(page);
                  }}
                  className={`absolute inset-0 flex items-center justify-center rounded-sm text-[14px] leading-none
                              text-wt-muted hover:text-wt-text hover:bg-white/10 transition-opacity
                              ${isActive && !dirty
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100'}`}
                  title="关闭 (Ctrl+W)"
                >
                  ×
                </button>
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
