// electron/main/ipc/updater.ts
// 自动更新 IPC：手动检查 / 下载 / 退出安装（状态推送由 service 直接 webContents.send）

import { ipcMain } from 'electron';
import { IPC } from '@shared/types/ipc';
import {
  checkForUpdatesManual,
  downloadUpdate,
  initAutoUpdater,
  quitAndInstallUpdate
} from '../services/updater';

export function registerUpdaterIpc(): void {
  initAutoUpdater();

  ipcMain.handle(IPC.CHECK_FOR_UPDATES, () => checkForUpdatesManual());
  ipcMain.handle(IPC.DOWNLOAD_UPDATE, () => downloadUpdate());
  ipcMain.handle(IPC.QUIT_INSTALL_UPDATE, () => {
    quitAndInstallUpdate();
  });
}
