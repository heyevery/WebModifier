// src/components/Updater/UpdateIndicator.tsx
// 应用更新提示：右下角浮条。
// - 后台静默检查发现新版本 → 提示下载；下载中显示进度；下载完提示重启安装
// - 后台检查失败（网络/仓库不可达）完全静默；只有用户主动触发的操作失败才 toast
// - 手动检查入口在命令面板「检查应用更新」，直接调 window.wt.checkForUpdates()

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from '@/components/Toast/toast';
import type { UpdateState } from '@shared/types/ipc';

type View =
  | { kind: 'hidden' }
  | { kind: 'checking-manual' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

/** 当前是否有用户主动发起的检查/下载（决定后台事件是否打扰用户） */
let userInitiated = false;

/** 命令面板调用：手动检查更新（不支持内置更新的环境给出明确提示） */
export async function manualCheckForUpdates(): Promise<void> {
  userInitiated = true;
  try {
    const r = await window.wt.checkForUpdates();
    if (!r.supported) {
      userInitiated = false;
      toast.info('开发版 / 便携版不支持内置更新，请前往发布页下载最新安装包');
      return;
    }
    if (!r.available) {
      toast.success(`已是最新版本（v${r.currentVersion}）`);
    }
    // available 的情况由 onUpdateStatus 事件统一提示，避免重复
  } catch (err) {
    toast.error(`检查更新失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

export function UpdateIndicator() {
  const [view, setView] = useState<View>({ kind: 'hidden' });
  // 最近一次得知的新版本号（downloading 事件本身不带版本）
  const latestVersionRef = useRef<string>('');

  useEffect(() => {
    return window.wt.onUpdateStatus((s: UpdateState) => {
      switch (s.phase) {
        case 'checking':
          if (userInitiated) setView({ kind: 'checking-manual' });
          break;
        case 'available': {
          const version = s.version ?? latestVersionRef.current;
          latestVersionRef.current = version;
          setView({ kind: 'available', version });
          toast.info(`发现新版本 v${version}，点击下方按钮下载`, 8000);
          break;
        }
        case 'not-available':
          if (userInitiated) {
            userInitiated = false;
            setView({ kind: 'hidden' });
          }
          break;
        case 'downloading':
          setView({
            kind: 'downloading',
            version: latestVersionRef.current,
            percent: s.percent ?? 0
          });
          break;
        case 'downloaded': {
          const version = s.version ?? latestVersionRef.current;
          latestVersionRef.current = version;
          userInitiated = false;
          setView({ kind: 'downloaded', version });
          toast.success(`v${version} 已下载完成，重启应用后生效`, 8000);
          break;
        }
        case 'error':
          if (userInitiated) {
            setView({ kind: 'error', message: s.message ?? '未知错误' });
            toast.error(`更新失败：${s.message ?? '未知错误'}`);
          }
          break;
      }
    });
  }, []);

  const startDownload = async (): Promise<void> => {
    userInitiated = true;
    setView({ kind: 'downloading', version: latestVersionRef.current, percent: 0 });
    try {
      const r = await window.wt.downloadUpdate();
      if (!r.ok) {
        userInitiated = false;
        toast.error('当前版本不支持内置更新');
      }
      // 后续进度 / downloaded 由事件驱动
    } catch (err) {
      toast.error(`下载失败：${err instanceof Error ? err.message : String(err)}`);
      setView({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };

  const retryCheck = (): void => {
    void manualCheckForUpdates();
  };

  const installNow = (): void => {
    void window.wt.quitAndInstallUpdate();
  };

  return (
    <AnimatePresence>
      {view.kind !== 'hidden' && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18 }}
          className="fixed bottom-4 left-4 z-50 w-[300px] rounded-md border border-wt-border-strong
                     bg-wt-surface shadow-wt-lg text-wt-text text-[12px] overflow-hidden"
          role="status"
        >
          {view.kind === 'checking-manual' && (
            <div className="px-3 py-2.5 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-wt-muted border-t-wt-text animate-spin" />
              正在检查更新…
            </div>
          )}

          {view.kind === 'available' && (
            <div className="px-3 py-2.5">
              <div className="font-medium text-wt-text-bright mb-2">
                发现新版本 v{view.version}
              </div>
              <button
                type="button"
                onClick={() => void startDownload()}
                className="w-full h-6 rounded bg-wt-primary hover:bg-wt-primary-hover text-white text-[12px]"
              >
                下载并安装
              </button>
            </div>
          )}

          {view.kind === 'downloading' && (
            <div className="px-3 py-2.5">
              <div className="flex justify-between mb-1.5">
                <span>正在下载 v{view.version}</span>
                <span className="text-wt-muted">{view.percent}%</span>
              </div>
              <div className="h-1.5 rounded bg-wt-surface-2 overflow-hidden">
                <div
                  className="h-full bg-wt-primary transition-[width] duration-200"
                  style={{ width: `${view.percent}%` }}
                />
              </div>
            </div>
          )}

          {view.kind === 'downloaded' && (
            <div className="px-3 py-2.5">
              <div className="font-medium text-wt-text-bright mb-2">
                v{view.version} 已就绪
              </div>
              <button
                type="button"
                onClick={installNow}
                className="w-full h-6 rounded bg-wt-primary hover:bg-wt-primary-hover text-white text-[12px]"
              >
                重启并更新
              </button>
            </div>
          )}

          {view.kind === 'error' && (
            <div className="px-3 py-2.5">
              <div className="text-wt-danger mb-2 break-words">更新失败：{view.message}</div>
              <button
                type="button"
                onClick={retryCheck}
                className="w-full h-6 rounded border border-wt-border-strong hover:bg-wt-list-hover text-[12px]"
              >
                重新检查
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
