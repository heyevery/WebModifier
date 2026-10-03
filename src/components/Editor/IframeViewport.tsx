// src/components/Editor/IframeViewport.tsx
// iframe 容器：加载 wt-template:// 协议的模板，监听 iframe 消息，把 postMessage 句柄注册到 store

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTemplateStore } from '@/store/template-store';
import { overrideCssText } from '@shared/css-isolation';
import type { IframeMessage, ParentMessage } from '@shared/types/region';
import { buildTemplateUrl, resolveKnownPage, resolvePagePath } from '@shared/template-url';
import { RegionOverlay } from './RegionOverlay';

// 响应式预览预设宽度（CSS px）
type ViewportMode = 'desktop' | 'tablet' | 'phone';
const VIEWPORTS: { mode: ViewportMode; label: string; width: number | null; icon: string; title: string }[] = [
  { mode: 'desktop', label: '桌面', width: null, icon: '🖥', title: '桌面宽度（100%）' },
  { mode: 'tablet', label: '平板', width: 768, icon: '📱', title: '平板宽度 768px' },
  { mode: 'phone', label: '手机', width: 390, icon: '📲', title: '手机宽度 390px' }
];
const VIEWPORT_STORAGE_KEY = 'wt-viewport-mode';
/** 状态栏点击切换视口时广播同一事件，保证两处 UI 同步 */
const VIEWPORT_EVENT = 'wt-viewport-change';

function readStoredViewport(): ViewportMode {
  try {
    const v = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);
    return v === 'tablet' || v === 'phone' || v === 'desktop' ? v : 'desktop';
  } catch {
    return 'desktop';
  }
}

export function IframeViewport() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const currentPage = useTemplateStore((s) => s.currentPage);
  const iframeReloadToken = useTemplateStore((s) => s.iframeReloadToken);
  const openTab = useTemplateStore((s) => s.openTab);
  const setRects = useTemplateStore((s) => s.setRects);
  const isLoading = useTemplateStore((s) => s.isLoading);
  const setIframeApi = useTemplateStore((s) => s.setIframeApi);
  const setSelectedRid = useTemplateStore((s) => s.setSelectedRid);

  // 响应式宽度（localStorage 记忆选择）
  const [viewport, setViewport] = useState<ViewportMode>(readStoredViewport);
  const changeViewport = useCallback((mode: ViewportMode) => {
    setViewport(mode);
    try {
      window.localStorage.setItem(VIEWPORT_STORAGE_KEY, mode);
    } catch {
      // 隐私模式忽略
    }
    window.dispatchEvent(new CustomEvent(VIEWPORT_EVENT, { detail: mode }));
  }, []);

  // 状态栏等其他 UI 切换视口时同步
  useEffect(() => {
    const onViewport = (e: Event): void => {
      const mode = (e as CustomEvent<ViewportMode>).detail;
      if (mode === 'tablet' || mode === 'phone' || mode === 'desktop') {
        setViewport(mode);
        try {
          window.localStorage.setItem(VIEWPORT_STORAGE_KEY, mode);
        } catch {
          // 隐私模式忽略
        }
      }
    };
    window.addEventListener(VIEWPORT_EVENT, onViewport);
    return () => window.removeEventListener(VIEWPORT_EVENT, onViewport);
  }, []);

  const handleMessage = useCallback(
    (e: MessageEvent) => {
      const msg = e.data as IframeMessage;
      if (!msg || typeof msg.type !== 'string') return;
      if (!msg.type.startsWith('wt-')) return;
      if (msg.type === 'wt-rects' && Array.isArray(msg.rects)) {
        setRects(msg.rects);
      } else if (msg.type === 'wt-ready') {
        // 主动请求一次 rects，防止 load 事件早于监听器挂载
        iframeRef.current?.contentWindow?.postMessage({ type: 'wt-request-rects' }, '*');
        const st = useTemplateStore.getState();
        // 页面重载后必须重放当前页全部编辑值：协议缓存中的 HTML 是解析时的原始内容，
        // 不重放会导致切页/撤销跳转后用户修改"消失"
        st.replayCurrentEdits();
        // 重放全部 CSS 覆盖（新文档中没有 <style id="wt-custom-css">），
        // 不能只注入当前文件：其他文件的修改同样要保留
        const customCss = overrideCssText(st.cssFiles, st.cssOverrides);
        if (customCss) {
          st.iframeApi?.postMessage({ type: 'wt-css-update', cssText: customCss });
        }
        // 重放全站自定义代码（统计 / 客服等），iframe 重载后注入节点已不存在
        if (st.headInjection || st.bodyInjection) {
          st.iframeApi?.postMessage({
            type: 'wt-inject-update',
            head: st.headInjection,
            body: st.bodyInjection
          });
        }
      } else if (msg.type === 'wt-navigate' && msg.href) {
        const st = useTemplateStore.getState();
        // 兼容 about/、/about/、about 等目录式/省扩展名写法
        const targetPage = resolveKnownPage(currentPage, msg.href, st.pages);
        // 只在模板确实包含该页面时切换，否则 iframe 会落到未注入 rid 的原始文件（能看不能编辑）
        if (!targetPage) {
          st.setError(`页面不存在：${resolvePagePath(currentPage, msg.href)}`);
          return;
        }
        openTab(targetPage);
      } else if (msg.type === 'wt-select' && msg.rid) {
        // iframe 内点击组件 → 选中对应区段
        setSelectedRid(msg.rid);
      }
    },
    [setRects, openTab, currentPage, setSelectedRid]
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // 注册 / 清理 postMessage 句柄到 store
  useEffect(() => {
    const postMessage = (msg: ParentMessage) => {
      iframeRef.current?.contentWindow?.postMessage(msg, '*');
    };
    setIframeApi({ postMessage });
    return () => setIframeApi(null);
  }, [setIframeApi]);

  if (!currentTemplate) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-wt-bg text-wt-muted text-sm">
        请从左侧选择一个模板开始编辑
      </div>
    );
  }

  // 模板切换的解析间隙（currentPage 被清空）：显示占位，避免 iframe 加载空/错误页面
  if (!currentPage) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-wt-bg text-wt-muted text-sm animate-pulse-soft">
        正在加载模板…
      </div>
    );
  }

  const activePreset = VIEWPORTS.find((v) => v.mode === viewport) ?? VIEWPORTS[0];

  return (
    <div className={`wt-iframe-wrap wt-viewport--${viewport}`}>
      {/* 响应式宽度切换 */}
      <div className="wt-viewport-toolbar">
        {VIEWPORTS.map((v) => (
          <button
            key={v.mode}
            onClick={() => changeViewport(v.mode)}
            title={v.title}
            className={`wt-viewport-btn ${v.mode === viewport ? 'wt-viewport-btn--active' : ''}`}
          >
            <span>{v.icon}</span>
            <span className="wt-viewport-btn-label">{v.label}</span>
          </button>
        ))}
        {activePreset.width !== null && (
          <span className="wt-viewport-width">{activePreset.width}px</span>
        )}
      </div>

      {/* iframe 与 overlay 共用同一个定宽舞台，保证高亮坐标对齐 */}
      <div
        className="wt-viewport-stage"
        style={activePreset.width !== null ? { width: activePreset.width } : undefined}
      >
        <iframe
          ref={iframeRef}
          key={`${currentTemplate}/${currentPage}/${iframeReloadToken}`}
          src={buildTemplateUrl(currentTemplate, currentPage)}
          title={`${currentTemplate} — ${currentPage}`}
        />
        <div className="wt-overlay-layer">
          <RegionOverlay />
        </div>
      </div>
      {isLoading && (
        <div className="absolute inset-0 bg-wt-bg/60 backdrop-blur-sm flex items-center justify-center">
          <div className="text-wt-muted text-sm animate-pulse-soft">正在加载模板…</div>
        </div>
      )}
    </div>
  );
}
