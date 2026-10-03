// src/App.tsx
// 应用根组件：VS Code 风格布局（活动栏 + 资源管理器 + 标签页 + 编辑器 + 属性面板）

import { Suspense, lazy, useEffect, type ComponentType, type LazyExoticComponent, type ReactElement } from 'react';
import { TopBar } from '@/components/TopBar/TopBar';
import { ActivityBar } from '@/components/ActivityBar/ActivityBar';
import { TabBar } from '@/components/TabBar/TabBar';
import { Breadcrumb } from '@/components/Breadcrumb/Breadcrumb';
import { Resizer } from '@/components/Resizer/Resizer';
import { AutosavePrompt } from '@/components/AutosavePrompt/AutosavePrompt';
import { StatusBar } from '@/components/StatusBar/StatusBar';
import { CommandPalette } from '@/components/CommandPalette/CommandPalette';
import { GlobalDialogs } from '@/components/GlobalDialogs/GlobalDialogs';
import { ToastHost } from '@/components/Toast/ToastHost';
import { UpdateIndicator } from '@/components/Updater/UpdateIndicator';
import { toast } from '@/components/Toast/toast';
import { useTemplateStore } from '@/store/template-store';

// 按需加载：首屏（主页外壳）不含编辑器/重型面板/对话框，打开工作区或切换面板时再拉取分块
// 这些模块均为具名导出组件，用 K 显式指定导出名
function namedLazy<M extends Record<string, ComponentType>, K extends keyof M>(
  loader: () => Promise<M>,
  key: K
): LazyExoticComponent<ComponentType> {
  return lazy(async () => ({ default: (await loader())[key] }));
}

const HomePage = namedLazy(() => import('@/components/Home/HomePage'), 'HomePage');
const FileTree = namedLazy(() => import('@/components/FileTree/FileTree'), 'FileTree');
const HistoryPanel = namedLazy(
  () => import('@/components/HistoryPanel/HistoryPanel'),
  'HistoryPanel'
);
const CssEditor = namedLazy(() => import('@/components/CssEditor/CssEditor'), 'CssEditor');
const ThemePanel = namedLazy(() => import('@/components/Theme/ThemePanel'), 'ThemePanel');
const MarketplacePanel = namedLazy(
  () => import('@/components/Marketplace/MarketplacePanel'),
  'MarketplacePanel'
);
const IframeViewport = namedLazy(
  () => import('@/components/Editor/IframeViewport'),
  'IframeViewport'
);
const PropertyPanel = namedLazy(
  () => import('@/components/Editor/PropertyPanel'),
  'PropertyPanel'
);

/** 侧栏/编辑器面板分块加载中的轻量占位 */
function PanelFallback(): ReactElement {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-wt-muted/40 animate-pulse" />
        <span className="w-1.5 h-1.5 rounded-full bg-wt-muted/40 animate-pulse [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-wt-muted/40 animate-pulse [animation-delay:300ms]" />
      </div>
    </div>
  );
}

function App() {
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const fetchProjects = useTemplateStore((s) => s.fetchProjects);
  const activePanel = useTemplateStore((s) => s.activePanel);
  const setSelectedRid = useTemplateStore((s) => s.setSelectedRid);
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const undo = useTemplateStore((s) => s.undo);
  const redo = useTemplateStore((s) => s.redo);
  const navigateBack = useTemplateStore((s) => s.navigateBack);
  const navigateForward = useTemplateStore((s) => s.navigateForward);
  const toggleSidebar = useTemplateStore((s) => s.toggleSidebar);
  const activeTab = useTemplateStore((s) => s.activeTab);
  const closeTab = useTemplateStore((s) => s.closeTab);

  // 初始加载模板列表与项目草稿列表
  useEffect(() => {
    fetchTemplates();
    fetchProjects();
  }, [fetchTemplates, fetchProjects]);

  // store.error 是各 action 的统一错误出口：变化为非空新值时弹 Toast。
  // （清空为 null 或重复的同一字符串不重复弹）
  useEffect(() => {
    let prev = useTemplateStore.getState().error;
    return useTemplateStore.subscribe((state) => {
      if (state.error && state.error !== prev) toast.error(state.error);
      prev = state.error;
    });
  }, []);

  // 兜底事件回调/异步任务里漏接的异常（用户注入代码运行在 iframe 独立窗口，不受此影响）
  useEffect(() => {
    const onError = (e: ErrorEvent): void => {
      if (!e.message) return;
      toast.error(`发生脚本错误：${e.message}`);
    };
    const onRejection = (e: PromiseRejectionEvent): void => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '未知原因');
      toast.error(`操作异常：${reason}`);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // 全局键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          redo();
        } else if (e.key.toLowerCase() === 'b') {
          // Ctrl+B 折叠/恢复侧边栏（Ctrl+Shift+P / Ctrl+P 由命令面板处理）
          e.preventDefault();
          toggleSidebar();
        } else if (e.key.toLowerCase() === 'w' && activeTab) {
          // Ctrl+W 关闭当前标签；无标签时不拦截（保留关窗语义）
          e.preventDefault();
          closeTab(activeTab);
        }
      } else if (e.altKey && !e.shiftKey) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateBack();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateForward();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, navigateBack, navigateForward, toggleSidebar, activeTab, closeTab]);

  // 点击 iframe 容器空白处取消选中
  useEffect(() => {
    if (!currentTemplate) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList?.contains('wt-overlay-layer')) {
        setSelectedRid(null);
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [currentTemplate, setSelectedRid]);

  const leftWidth = useTemplateStore((s) => s.leftWidth);
  const rightWidth = useTemplateStore((s) => s.rightWidth);

  // 侧边面板内容
  const sidebar = () => {
    if (!activePanel) return null;
    return (
      <Suspense fallback={<PanelFallback />}>
        {activePanel === 'explorer' && <FileTree />}
        {activePanel === 'history' && <HistoryPanel />}
        {activePanel === 'styles' && <CssEditor />}
        {activePanel === 'theme' && <ThemePanel />}
        {activePanel === 'marketplace' && <MarketplacePanel />}
      </Suspense>
    );
  };

  // 无工作区时仅允许模板市场侧栏（资源管理器/样式/历史依赖已打开模板）
  const showLeftSidebar = !!activePanel && (!!currentTemplate || activePanel === 'marketplace');

  return (
    <div className="h-screen w-screen flex flex-col bg-wt-bg overflow-hidden">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <ActivityBar />
        {showLeftSidebar && (
          <>
            <div className="h-full flex-shrink-0" style={{ width: leftWidth }}>
              {sidebar()}
            </div>
            <Resizer side="left" />
          </>
        )}
        {currentTemplate ? (
          <main className="flex-1 flex flex-col overflow-hidden min-w-0">
            <TabBar />
            <Breadcrumb />
            <div className="flex-1 relative overflow-hidden">
              <Suspense fallback={<PanelFallback />}>
                <IframeViewport />
              </Suspense>
            </div>
          </main>
        ) : (
          <main className="flex-1 flex flex-col overflow-hidden min-w-0">
            <Suspense fallback={<PanelFallback />}>
              <HomePage />
            </Suspense>
          </main>
        )}
        {currentTemplate && (
          <>
            <Resizer side="right" />
            <div className="h-full flex-shrink-0" style={{ width: rightWidth }}>
              <Suspense fallback={<PanelFallback />}>
                <PropertyPanel />
              </Suspense>
            </div>
          </>
        )}
      </div>
      <StatusBar />
      {/* Ctrl+Shift+P 命令面板 / Ctrl+P 快速切页 */}
      <CommandPalette />
      {/* 新建工作区 / 导入模板全局对话框 */}
      <GlobalDialogs />
      {/* 崩溃/异常退出后再次打开：恢复自动草稿提示 */}
      <AutosavePrompt />
      {/* 全局轻量通知（右下角 Toast） */}
      <ToastHost />
      {/* 应用自动更新提示（左下角浮条，仅打包安装版生效） */}
      <UpdateIndicator />
    </div>
  );
}

export default App;
