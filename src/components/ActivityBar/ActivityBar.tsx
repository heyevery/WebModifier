// src/components/ActivityBar/ActivityBar.tsx
// VS Code 风格活动栏：竖向图标按钮，切换侧边面板

import { motion } from 'framer-motion';
import { useTemplateStore, type SidebarPanel } from '@/store/template-store';

interface IconDef {
  id: SidebarPanel;
  label: string;
  svg: React.ReactNode;
}

const ICONS: IconDef[] = [
  {
    id: 'marketplace',
    label: '模板市场',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l1.5-5h15L21 9" />
        <path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
        <path d="M9 13h6" />
        <path d="M3 9h18" />
      </svg>
    )
  },
  {
    id: 'explorer',
    label: '资源管理器',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </svg>
    )
  },
  {
    id: 'styles',
    label: '样式',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" />
        <path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" />
      </svg>
    )
  },
  {
    id: 'theme',
    label: '主题变量',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.5-1-1.9-1-3 0-1.1.9-2 2-2h1.5A4.5 4.5 0 0 0 21 9.5C21 5.9 16.9 3 12 3z" />
        <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
        <circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="17" cy="11" r="1" fill="currentColor" stroke="none" />
      </svg>
    )
  },
  {
    id: 'history',
    label: '历史',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l3 2" />
      </svg>
    )
  }
];

export function ActivityBar() {
  const activePanel = useTemplateStore((s) => s.activePanel);
  const togglePanel = useTemplateStore((s) => s.togglePanel);
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const goHome = useTemplateStore((s) => s.goHome);

  const homeActive = !currentTemplate;

  return (
    <nav className="w-12 flex-shrink-0 h-full bg-wt-activitybar flex flex-col items-stretch py-1">
      {/* 主页：工作区 / 模板库 / 我的项目 */}
      <button
        onClick={() => void goHome()}
        title="主页（工作区与草稿）"
        className={`relative w-12 h-12 flex items-center justify-center transition-colors ${
          homeActive ? 'text-wt-text-bright' : 'text-wt-muted hover:text-wt-text'
        }`}
      >
        {homeActive && (
          <motion.div
            layoutId="activity-indicator"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-10 bg-wt-text-bright"
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          />
        )}
        <span className="w-6 h-6">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5 10v10h14V10" />
            <path d="M9.5 20v-6h5v6" />
          </svg>
        </span>
      </button>

      <div className="w-6 h-px bg-wt-border-strong mx-auto my-1 flex-shrink-0" />

      {ICONS.map((icon) => {
        const isActive = activePanel === icon.id;
        return (
          <button
            key={icon.id}
            onClick={() => togglePanel(icon.id)}
            title={icon.label}
            className={`relative w-12 h-12 flex items-center justify-center transition-colors ${
              isActive
                ? 'text-wt-text-bright'
                : 'text-wt-muted hover:text-wt-text'
            }`}
          >
            {isActive && currentTemplate && (
              <motion.div
                layoutId="activity-indicator"
                className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-10 bg-wt-text-bright"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span className="w-6 h-6">{icon.svg}</span>
          </button>
        );
      })}
    </nav>
  );
}
