// src/components/ErrorBoundary/ErrorBoundary.tsx
// 渲染层兜底：任意子组件渲染/生命周期抛错时显示恢复面板，避免整个应用白屏。
// 仅兜底渲染异常；事件回调/Promise 中的错误由全局监听 + Toast 处理。

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] render crash:', error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="h-screen w-screen flex items-center justify-center bg-wt-bg p-6">
        <div className="w-[420px] max-w-full rounded-lg border border-wt-border bg-wt-surface p-6 shadow-wt-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">⚠️</span>
            <h1 className="text-sm font-semibold text-wt-text">界面出现异常</h1>
          </div>
          <p className="text-xs text-wt-muted leading-relaxed mb-3">
            编辑内容会通过自动草稿保留，重新加载后可在恢复提示中继续。
          </p>
          <pre className="max-h-40 overflow-auto rounded-md bg-wt-bg border border-wt-border p-2.5
                          text-[11px] font-mono text-wt-danger/90 whitespace-pre-wrap break-words mb-4">
            {error.message || String(error)}
          </pre>
          <div className="flex justify-end">
            <button
              onClick={this.reload}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-wt-primary
                         hover:bg-wt-primary-hover text-white transition-colors"
            >
              重新加载界面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
