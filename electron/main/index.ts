// electron/main/index.ts
// 主进程入口

import { app, BrowserWindow, dialog, Menu, protocol, shell } from 'electron';
import * as path from 'path';
import { registerTemplateProtocol } from './protocol/template-protocol';
import { registerIpc, getContentDirty, takeAllowQuit } from './ipc/template';
import { registerUpdaterIpc } from './ipc/updater';
import { migrateBundledTemplates } from './services/app-paths';

/** 与 preload 的事件通道保持一致：请求渲染层落盘自动草稿 */
const EVENT_QUIT_SAVE = 'wt:quit-save';

// 注册协议为标准协议，使相对 URL 解析正确（必须在 app ready 之前调用）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wt-template',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 开发环境：加载 Vite dev server；生产：加载打包后的 renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    win.webContents.openDevTools({ mode: 'detach' });
    // 无原生菜单后，补回开发常用快捷键：F12/Ctrl+Shift+I 切换 DevTools，F5/Ctrl+R 重载
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const mod = input.control || input.meta;
      if (input.key === 'F12' || (mod && input.shift && input.key.toLowerCase() === 'i')) {
        win.webContents.toggleDevTools();
        event.preventDefault();
      } else if (input.key === 'F5' || (mod && !input.shift && input.key.toLowerCase() === 'r')) {
        win.webContents.reload();
        event.preventDefault();
      }
    });
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // 关闭拦截：有未保存修改时询问；「保存并退出」由渲染层落盘后 CONFIRM_QUIT 放行
  let forceClose = false;
  win.on('close', async (e) => {
    if (forceClose || takeAllowQuit()) return;
    if (!getContentDirty()) return;
    e.preventDefault();

    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['保存并退出', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: '有未保存的内容',
      message: '当前工作区有尚未保存的修改。',
      detail: '选择「保存并退出」会把修改写入自动草稿，下次打开可恢复；「不保存」将丢弃这些修改。'
    });

    if (response === 2) return; // 取消
    if (response === 1) {
      // 不保存：直接退出，不再拦截
      forceClose = true;
      win.close();
      return;
    }
    // 保存并退出：通知渲染层落盘；渲染层完成后调 confirmQuit 再次触发关闭
    win.webContents.send(EVENT_QUIT_SAVE);
  });

  return win;
}

/**
 * 移除应用原生菜单栏（Windows 上是浅色白条，与深色界面冲突，
 * 且其 Ctrl+W 会先于渲染层关闭窗口）。
 * 输入框内复制/粘贴/全选由 Chromium 直接处理，不依赖菜单；
 * DevTools/重载快捷键在开发环境单独绑定（见 createWindow）。
 */
function installMenu(): void {
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  migrateBundledTemplates(); // 首次运行：拷贝随安装包带的示例模板到 userData
  registerTemplateProtocol();
  registerIpc();
  registerUpdaterIpc();
  installMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
