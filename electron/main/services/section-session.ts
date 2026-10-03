// electron/main/services/section-session.ts
// 会话级区块结构存储：模板名 → 页面 → SectionStructure。
// 只活在内存 + 随项目草稿/自动保存持久化（由渲染层带回）；模板磁盘永远是干净基线。

import type { StructureByPage, SectionStructure } from '@shared/section-structure';

const sessions = new Map<string, StructureByPage>();

export function getStructure(templateName: string): StructureByPage {
  return sessions.get(templateName) ?? {};
}

export function getPageStructure(
  templateName: string,
  page: string
): SectionStructure | undefined {
  return sessions.get(templateName)?.[page];
}

/** 整表替换（打开项目草稿时恢复用）；空表等价于清空 */
export function setStructure(templateName: string, structure: StructureByPage | undefined): void {
  if (!structure || Object.keys(structure).length === 0) {
    sessions.delete(templateName);
    return;
  }
  sessions.set(templateName, structuredClone(structure));
}

export function setPageStructure(
  templateName: string,
  page: string,
  structure: SectionStructure
): void {
  const table = sessions.get(templateName) ?? {};
  table[page] = structure;
  sessions.set(templateName, table);
}

/** 删除单页结构（该页回到模板默认）；表空时整表移除 */
export function removePageStructure(templateName: string, page: string): void {
  const table = sessions.get(templateName);
  if (!table || !(page in table)) return;
  delete table[page];
  if (Object.keys(table).length === 0) sessions.delete(templateName);
}

export function clearStructure(templateName?: string): void {
  if (templateName) sessions.delete(templateName);
  else sessions.clear();
}

/** 工作区改名：会话表整体挂到新模板名下 */
export function renameSession(oldName: string, newName: string): void {
  if (oldName === newName) return;
  const table = sessions.get(oldName);
  if (!table) return;
  sessions.delete(oldName);
  sessions.set(newName, table);
}

/** 页面改名：迁移该页结构；newPage 缺省 = 删除页面（丢弃该页结构） */
export function migratePageStructure(
  templateName: string,
  oldPage: string,
  newPage?: string
): void {
  const table = sessions.get(templateName);
  if (!table || !(oldPage in table)) return;
  if (newPage) {
    table[newPage] = table[oldPage];
  }
  delete table[oldPage];
}
