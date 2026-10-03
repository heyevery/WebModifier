// electron/main/services/updater.ts
// electron-updater 封装：从 GitHub Releases 检查/下载/安装新版本。
// - 仅「已打包 + 非 portable 便携版」启用（dev 与单文件版无固定安装目录，内置更新不适用）
// - 启动后延迟做一次静默检查（不弹错误）；手动检查由渲染层触发
// - 不自动下载：发现新版本后由用户确认，进度/结果通过事件推送给渲染层

import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import {
  UPDATE_STATUS_EVENT,
  type CheckUpdatesResult,
  type UpdateState
} from '@shared/types/ipc';

// electron-updater 仅提供 CommonJS 产物：ESM 命名导入在本项目主进程（dev 与 build 均输出 ESM、
// 依赖 external）下无法被 cjs-module-lexer 识别，会抛 "Named export not found"，统一用 createRequire
const localRequire = createRequire(import.meta.url);
const { autoUpdater } =
  localRequire('electron-updater') as typeof import('electron-updater');

/**
 * portable 单文件版运行时会带此环境变量；dev 用 app.isPackaged 排除。
 * Linux 上 electron-updater 仅支持 AppImage 自动更新（deb 安装版不支持）。
 */
export function isUpdateSupported(): boolean {
  if (!app.isPackaged || process.env['PORTABLE_EXECUTABLE_DIR']) return false;
  if (process.platform === 'linux') return Boolean(process.env['APPIMAGE']);
  return true; // win32(nsis) / darwin(.app)
}

let initialized = false;

function broadcast(state: UpdateState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(UPDATE_STATUS_EVENT, state);
  }
}

/** 订阅 autoUpdater 事件并安排启动后的静默检查；只初始化一次 */
export function initAutoUpdater(): void {
  if (initialized || !isUpdateSupported()) return;
  initialized = true;

  autoUpdater.autoDownload = false; // 用户确认后才下载
  autoUpdater.autoInstallOnAppQuit = true; // 已下载的更新在退出应用时自动安装

  autoUpdater.on('checking-for-update', () => {
    broadcast({ phase: 'checking', currentVersion: app.getVersion() });
  });
  autoUpdater.on('update-available', (info) => {
    broadcast({
      phase: 'available',
      version: info.version,
      currentVersion: app.getVersion()
    });
  });
  autoUpdater.on('update-not-available', () => {
    broadcast({ phase: 'not-available', currentVersion: app.getVersion() });
  });
  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      phase: 'downloading',
      percent: Math.round(progress.percent ?? 0),
      currentVersion: app.getVersion()
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    broadcast({
      phase: 'downloaded',
      version: info.version,
      currentVersion: app.getVersion()
    });
  });
  autoUpdater.on('error', (err) => {
    broadcast({
      phase: 'error',
      message: err instanceof Error ? err.message : String(err),
      currentVersion: app.getVersion()
    });
  });

  // 启动 10 秒后静默检查；失败只走 error 事件（渲染端对后台错误不打扰用户）
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* 后台静默检查：网络/仓库不可达无需提示 */
    });
  }, 10_000);
}

/** 手动检查更新（命令面板/更新按钮）；返回是否有新版本 */
export async function checkForUpdatesManual(): Promise<CheckUpdatesResult> {
  if (!isUpdateSupported()) {
    return { supported: false, available: false, currentVersion: app.getVersion() };
  }
  const result = await autoUpdater.checkForUpdates();
  return {
    supported: true,
    available: Boolean(result?.updateInfo),
    version: result?.updateInfo?.version,
    currentVersion: app.getVersion()
  };
}

export async function downloadUpdate(): Promise<{ ok: boolean }> {
  if (!isUpdateSupported()) return { ok: false };
  await autoUpdater.downloadUpdate();
  return { ok: true };
}

export function quitAndInstallUpdate(): void {
  if (isUpdateSupported()) autoUpdater.quitAndInstall();
}
