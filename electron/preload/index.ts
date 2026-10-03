// electron/preload/index.ts
// 通过 contextBridge 暴露安全 IPC API 给 renderer

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, UPDATE_STATUS_EVENT } from '@shared/types/ipc';
import type {
  CheckExportArgs,
  CheckHealthArgs,
  ExportTemplateArgs,
  ListCssFilesArgs,
  ListFilesArgs,
  PickImageArgs,
  ReadCssFileArgs,
  ResetTemplateArgs,
  ImportPageArgs,
  CreateWorkspaceArgs,
  SaveProjectArgs,
  DeleteProjectArgs,
  UseMarketTemplateArgs,
  WebModifierApi,
  ManagePageArgs,
  SetPageOrderArgs,
  PageMetaArgs,
  WritePageMetaArgs,
  ApplySiteHeadArgs,
  ManageTemplateArgs,
  SaveAutosaveArgs,
  GetAutosaveArgs,
  DeleteAutosaveArgs,
  SetDirtyArgs,
  ShellOpenArgs,
  UpdateState,
  SectionOpArgs,
  SetStructureArgs,
  ScanExternalImagesArgs,
  LocalizeImagesArgs
} from '@shared/types/ipc';

/** 主进程 → 渲染层事件通道 */
const EVENT_QUIT_SAVE = 'wt:quit-save';

const api: WebModifierApi = {
  listTemplates: () => ipcRenderer.invoke(IPC.LIST_TEMPLATES),
  listFiles: (args: ListFilesArgs) => ipcRenderer.invoke(IPC.LIST_FILES, args),
  parseTemplate: (templateName: string) =>
    ipcRenderer.invoke(IPC.PARSE_TEMPLATE, { templateName }),
  exportTemplate: (args: ExportTemplateArgs) => ipcRenderer.invoke(IPC.EXPORT_TEMPLATE, args),
  pickDirectory: () => ipcRenderer.invoke(IPC.PICK_DIRECTORY),
  importTemplate: () => ipcRenderer.invoke(IPC.IMPORT_TEMPLATE),
  checkExport: (args: CheckExportArgs) => ipcRenderer.invoke(IPC.CHECK_EXPORT, args),
  checkExportHealth: (args: CheckHealthArgs) =>
    ipcRenderer.invoke(IPC.CHECK_EXPORT_HEALTH, args),
  pickImage: (args: PickImageArgs) => ipcRenderer.invoke(IPC.PICK_IMAGE, args),
  getExportDir: () => ipcRenderer.invoke(IPC.GET_EXPORT_DIR),
  listCssFiles: (args: ListCssFilesArgs) => ipcRenderer.invoke(IPC.LIST_CSS_FILES, args),
  readCssFile: (args: ReadCssFileArgs) => ipcRenderer.invoke(IPC.READ_CSS_FILE, args),
  listMarketTemplates: () => ipcRenderer.invoke(IPC.LIST_MARKET_TEMPLATES),
  useMarketTemplate: (args: UseMarketTemplateArgs) =>
    ipcRenderer.invoke(IPC.USE_MARKET_TEMPLATE, args),
  resetTemplate: (args: ResetTemplateArgs) => ipcRenderer.invoke(IPC.RESET_TEMPLATE, args),
  importPage: (args: ImportPageArgs) => ipcRenderer.invoke(IPC.IMPORT_PAGE, args),
  createWorkspace: (args: CreateWorkspaceArgs) =>
    ipcRenderer.invoke(IPC.CREATE_WORKSPACE, args),
  listProjects: () => ipcRenderer.invoke(IPC.LIST_PROJECTS),
  saveProject: (args: SaveProjectArgs) => ipcRenderer.invoke(IPC.SAVE_PROJECT, args),
  readProject: (id: string) => ipcRenderer.invoke(IPC.READ_PROJECT, id),
  deleteProject: (args: DeleteProjectArgs) => ipcRenderer.invoke(IPC.DELETE_PROJECT, args),
  managePage: (args: ManagePageArgs) => ipcRenderer.invoke(IPC.MANAGE_PAGE, args),
  setPageOrder: (args: SetPageOrderArgs) => ipcRenderer.invoke(IPC.SET_PAGE_ORDER, args),
  readPageMeta: (args: PageMetaArgs) => ipcRenderer.invoke(IPC.READ_PAGE_META, args),
  writePageMeta: (args: WritePageMetaArgs) => ipcRenderer.invoke(IPC.WRITE_PAGE_META, args),
  applySiteHead: (args: ApplySiteHeadArgs) => ipcRenderer.invoke(IPC.APPLY_SITE_HEAD, args),
  manageTemplate: (args: ManageTemplateArgs) => ipcRenderer.invoke(IPC.MANAGE_TEMPLATE, args),
  saveAutosave: (args: SaveAutosaveArgs) => ipcRenderer.invoke(IPC.SAVE_AUTOSAVE, args),
  getAutosave: (args: GetAutosaveArgs) => ipcRenderer.invoke(IPC.GET_AUTOSAVE, args),
  deleteAutosave: (args: DeleteAutosaveArgs) => ipcRenderer.invoke(IPC.DELETE_AUTOSAVE, args),
  setDirty: (args: SetDirtyArgs) => ipcRenderer.invoke(IPC.SET_DIRTY, args),
  confirmQuit: () => ipcRenderer.invoke(IPC.CONFIRM_QUIT),
  openPath: (args: ShellOpenArgs) => ipcRenderer.invoke(IPC.SHELL_OPEN, args),
  getPreviewDir: () => ipcRenderer.invoke(IPC.GET_PREVIEW_DIR),
  checkForUpdates: () => ipcRenderer.invoke(IPC.CHECK_FOR_UPDATES),
  downloadUpdate: () => ipcRenderer.invoke(IPC.DOWNLOAD_UPDATE),
  quitAndInstallUpdate: () => ipcRenderer.invoke(IPC.QUIT_INSTALL_UPDATE),
  onUpdateStatus: (cb: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState): void =>
      cb(state);
    ipcRenderer.on(UPDATE_STATUS_EVENT, listener);
    return () => ipcRenderer.removeListener(UPDATE_STATUS_EVENT, listener);
  },
  sectionOp: (args: SectionOpArgs) => ipcRenderer.invoke(IPC.SECTION_OP, args),
  setStructure: (args: SetStructureArgs) => ipcRenderer.invoke(IPC.SET_STRUCTURE, args),
  scanExternalImages: (args: ScanExternalImagesArgs) =>
    ipcRenderer.invoke(IPC.SCAN_EXTERNAL_IMAGES, args),
  localizeImages: (args: LocalizeImagesArgs) => ipcRenderer.invoke(IPC.LOCALIZE_IMAGES, args),
  onQuitSave: (cb: () => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(EVENT_QUIT_SAVE, listener);
    return () => ipcRenderer.removeListener(EVENT_QUIT_SAVE, listener);
  }
};

contextBridge.exposeInMainWorld('wt', api);
