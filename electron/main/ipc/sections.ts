// electron/main/ipc/sections.ts
// 区块结构操作：复制 / 上移 / 下移 / 删除块级标记区段。
// 变换只写会话内存（section-session），模板盘不动；操作后清 display 缓存并重解析。

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '@shared/types/ipc';
import type {
  ParseTemplateResult,
  SectionOpArgs,
  SectionOpResult,
  SetStructureArgs
} from '@shared/types/ipc';
import {
  defaultStructure,
  duplicateInstance,
  isDefaultStructure,
  moveInstance,
  parseBlocks,
  removeInstance,
  type SectionStructure
} from '@shared/section-structure';
import { getTemplateDir } from '../services/template-manager';
import {
  getPageStructure,
  removePageStructure,
  setPageStructure,
  setStructure
} from '../services/section-session';
import { clearDisplayHtml } from '../protocol/template-protocol';

/** buildParseResult 由 template.ts 注册时注入（避免循环依赖） */
type Reparse = (templateName: string) => Promise<ParseTemplateResult>;

async function readPageHtml(templateName: string, page: string): Promise<string> {
  return fs.promises.readFile(path.join(getTemplateDir(templateName), page), 'utf-8');
}

/** 取页面当前生效结构（无会话变换时由基线区块生成） */
async function resolveCurrentStructure(
  templateName: string,
  page: string
): Promise<{ html: string; structure: SectionStructure }> {
  const html = await readPageHtml(templateName, page);
  const structure = getPageStructure(templateName, page) ?? defaultStructure(parseBlocks(html));
  return { html, structure };
}

/** 复制后克隆实例内的 region id 映射：外层区块 + 区块内层 attr 标记 */
function buildClonedMapping(
  sourceRaw: string,
  sourceInstanceId: string,
  newId: string
): { id: string; sourceId: string }[] {
  const suffix = newId.startsWith(sourceInstanceId)
    ? newId.slice(sourceInstanceId.length)
    : `-${newId}`;
  const mapped = [{ id: newId, sourceId: sourceInstanceId }];
  for (const m of sourceRaw.matchAll(/data-wt-edit="([^"]+)"/g)) {
    const innerId = m[1];
    mapped.push({
      id: innerId === sourceInstanceId ? newId : `${innerId}${suffix}`,
      sourceId: innerId
    });
  }
  return mapped;
}

export function registerSectionIpc(reparse: Reparse): void {
  ipcMain.handle(IPC.SECTION_OP, async (_, args: SectionOpArgs): Promise<SectionOpResult> => {
    const { templateName, page, action, id } = args;
    const { html, structure } = await resolveCurrentStructure(templateName, page);
    const blocks = parseBlocks(html);
    let cloned: SectionOpResult['cloned'];

    let next = structure;
    if (action === 'duplicate') {
      const used = new Set<string>([
        ...blocks.map((b) => b.id),
        ...structure.order.map((inst) => inst.id)
      ]);
      const result = duplicateInstance(structure, id, used);
      if (!result.newId) throw new Error(`未找到要复制的区块：${id}`);
      const sourceInstance = structure.order.find((inst) => inst.id === id);
      const sourceRaw = blocks.find((b) => b.id === sourceInstance?.sourceId)?.raw ?? '';
      cloned = buildClonedMapping(sourceRaw, id, result.newId);
      next = result.structure;
    } else if (action === 'move-up') {
      next = moveInstance(structure, id, -1);
    } else if (action === 'move-down') {
      next = moveInstance(structure, id, 1);
    } else if (action === 'delete') {
      next = removeInstance(structure, id);
    }

    // 回到模板默认序列则清除该页会话键，否则落会话；渲染层以返回值为唯一准绳
    let pageStructure: SectionStructure | null;
    if (isDefaultStructure(html, next)) {
      removePageStructure(templateName, page);
      pageStructure = null;
    } else {
      setPageStructure(templateName, page, next);
      pageStructure = next;
    }
    clearDisplayHtml(templateName);
    const result = await reparse(templateName);
    return { ...result, cloned, structure: pageStructure };
  });

  ipcMain.handle(IPC.SET_STRUCTURE, async (_, args: SetStructureArgs): Promise<ParseTemplateResult> => {
    setStructure(args.templateName, args.structureByPage);
    clearDisplayHtml(args.templateName);
    return reparse(args.templateName);
  });
}
