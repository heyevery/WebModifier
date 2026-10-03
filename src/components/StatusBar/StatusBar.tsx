// src/components/StatusBar/StatusBar.tsx
// 底部状态栏（VSCode 蓝条）：保存状态/当前页信息（左）；选中区段/视口/自动保存（右）

import { useEffect, useState } from 'react';
import { useTemplateStore } from '@/store/template-store';

const VIEWPORT_STORAGE_KEY = 'wt-viewport-mode';
const VIEWPORT_EVENT = 'wt-viewport-change';
type ViewportMode = 'desktop' | 'tablet' | 'phone';
const VIEWPORT_LABEL: Record<ViewportMode, string> = {
  desktop: '桌面 100%',
  tablet: '平板 768px',
  phone: '手机 390px'
};
const VIEWPORT_ORDER: ViewportMode[] = ['desktop', 'tablet', 'phone'];

function readViewport(): ViewportMode {
  try {
    const v = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);
    return v === 'tablet' || v === 'phone' || v === 'desktop' ? v : 'desktop';
  } catch {
    return 'desktop';
  }
}

export function StatusBar() {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const currentPage = useTemplateStore((s) => s.currentPage);
  const dirtyTabs = useTemplateStore((s) => s.dirtyTabs);
  const pendingAutosave = useTemplateStore((s) => s.pendingAutosave);
  const regions = useTemplateStore((s) => s.regions);
  const selectedRid = useTemplateStore((s) => s.selectedRid);

  const [viewport, setViewport] = useState<ViewportMode>(readViewport);

  useEffect(() => {
    const onViewport = (e: Event): void => {
      const mode = (e as CustomEvent<ViewportMode>).detail;
      if (mode === 'tablet' || mode === 'phone' || mode === 'desktop') setViewport(mode);
    };
    window.addEventListener(VIEWPORT_EVENT, onViewport);
    return () => window.removeEventListener(VIEWPORT_EVENT, onViewport);
  }, []);

  if (!currentTemplate) return null;

  const dirtyCount = Object.values(dirtyTabs).filter(Boolean).length;
  const selected = regions.find((r) => r.anchorRids?.includes(selectedRid ?? ''))
    ?? regions.find((r) => r.id === selectedRid)
    ?? null;

  // 点击视口状态：桌面 → 平板 → 手机 循环切换（IframeViewport 监听同一事件）
  const cycleViewport = (): void => {
    const next = VIEWPORT_ORDER[(VIEWPORT_ORDER.indexOf(viewport) + 1) % VIEWPORT_ORDER.length];
    setViewport(next);
    try {
      window.localStorage.setItem(VIEWPORT_STORAGE_KEY, next);
    } catch {
      // 隐私模式忽略
    }
    window.dispatchEvent(new CustomEvent(VIEWPORT_EVENT, { detail: next }));
  };

  return (
    <footer
      className="h-[22px] flex-shrink-0 flex items-center bg-wt-statusbar text-white text-[12px]
                 select-none overflow-hidden"
    >
      {/* 左簇：保存/草稿状态 */}
      <div className="flex items-center h-full min-w-0">
        {pendingAutosave ? (
          <StatusItem title="检测到未恢复的自动草稿，可在弹窗中恢复">○ 草稿待恢复</StatusItem>
        ) : dirtyCount > 0 ? (
          <StatusItem title={`有 ${dirtyCount} 个页面存在未保存修改，将自动存入草稿`}>
            ● {dirtyCount} 个页面未保存
          </StatusItem>
        ) : (
          <StatusItem title="所有修改已保存">✓ 已保存</StatusItem>
        )}
      </div>

      <div className="flex-1" />

      {/* 右簇：选中区段 / 当前页 / 视口 / 自动保存 */}
      <div className="flex items-center h-full">
        {selected && (
          <StatusItem title={`当前选中区段：${selected.id}`}>
            区段: {selected.label || selected.id}
          </StatusItem>
        )}
        <StatusItem title={currentPage}>{currentPage}</StatusItem>
        <StatusItem as="button" onClick={cycleViewport} title="点击切换预览宽度（桌面 / 平板 / 手机）">
          {VIEWPORT_LABEL[viewport]}
        </StatusItem>
        <StatusItem title="编辑内容会自动保存为草稿，可在下次打开时恢复">自动保存</StatusItem>
      </div>
    </footer>
  );
}

function StatusItem({
  children,
  title,
  as = 'span',
  onClick
}: {
  children: React.ReactNode;
  title?: string;
  as?: 'span' | 'button';
  onClick?: () => void;
}) {
  const cls =
    'h-full flex items-center px-2 whitespace-nowrap overflow-hidden text-ellipsis' +
    (as === 'button' ? ' cursor-pointer hover:bg-white/20' : '');
  return as === 'button' ? (
    <button type="button" className={cls} title={title} onClick={onClick}>
      {children}
    </button>
  ) : (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}
