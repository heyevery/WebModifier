// electron/main/services/project-manager.ts
// 项目草稿：把工作区当前编辑进度保存为独立草稿文件。
// 草稿只存「相对模板基线的差异值」，绝不修改 templates/ 下的模板文件；
// 打开草稿 = 重新解析源模板 + 叠加差异值。

import * as fs from 'fs';
import * as path from 'path';
import type { SiteInjections } from '@shared/types/ipc';
import type { StructureByPage } from '@shared/section-structure';
import type { SharedEdits } from '@shared/shared-regions';
import { getProjectsDir, getTemplatesDir } from './app-paths';
import { rmFileRobust } from './fs-utils';

const PROJECTS_DIR = getProjectsDir();
const TEMPLATES_DIR = getTemplatesDir();
const FILE_SUFFIX = '.wt-project.json';
// 自动草稿 id 前缀；列表时过滤，不与用户显式保存的项目混在一起
const AUTOSAVE_PREFIX = 'autosave__';

// 草稿磁盘结构（与 IPC 传输一致）
export interface ProjectFile {
  id: string;
  name: string; // 显示名（支持中文）
  templateName: string; // 源模板目录名
  createdAt: number;
  updatedAt: number;
  // 页面 POSIX 路径 → (region id → 当前值)，仅包含与基线不同的项
  edits: Record<string, Record<string, string>>;
  // CSS 文件 POSIX 路径 → 完整 CSS 文本，仅包含与模板基线不同的文件
  cssEdits?: Record<string, string>;
  // 全站自定义代码（head/body），内容非空才落盘
  injections?: SiteInjections;
  // 区块结构（复制/删除/排序），仅含有变换的页面
  structureByPage?: StructureByPage;
  // 全站公共区值（region id → 全站唯一值）
  sharedEdits?: SharedEdits;
}

export interface ProjectMeta {
  id: string;
  name: string;
  templateName: string;
  editCount: number;
  cssCount: number;
  createdAt: number;
  updatedAt: number;
  // 源模板是否还在（被删除时草稿无法打开）
  templateExists: boolean;
}

export interface SaveProjectArgs {
  id?: string; // 有 id = 更新已有草稿；无 id = 新建
  name: string;
  templateName: string;
  edits: Record<string, Record<string, string>>;
  cssEdits?: Record<string, string>;
  injections?: SiteInjections;
  structureByPage?: StructureByPage;
  sharedEdits?: SharedEdits;
}

function countCss(cssEdits?: Record<string, string>): number {
  return cssEdits ? Object.keys(cssEdits).length : 0;
}

/** 去掉全空白的 head/body；两者皆空返回 undefined（草稿不落盘空字段） */
function normalizeInjections(inj?: SiteInjections): SiteInjections | undefined {
  if (!inj) return undefined;
  const out: SiteInjections = {};
  const head = (inj.head ?? '').trim();
  const body = (inj.body ?? '').trim();
  if (head) out.head = head;
  if (body) out.body = body;
  return Object.keys(out).length > 0 ? out : undefined;
}

// 文件名清洗：保留中文，去非法字符与路径分隔
function sanitizeId(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned || 'project';
}

function projectPath(id: string): string {
  // 防路径逃逸：id 只能是单段文件名
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error('非法项目 id');
  }
  return path.join(PROJECTS_DIR, `${id}${FILE_SUFFIX}`);
}

function countEdits(edits: ProjectFile['edits']): number {
  return Object.values(edits).reduce((sum, page) => sum + Object.keys(page).length, 0);
}

/** 列出全部草稿（按最近更新倒序） */
export async function listProjects(): Promise<ProjectMeta[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const metas: ProjectMeta[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(FILE_SUFFIX)) continue;
    // 自动草稿不出现在「我的项目」列表
    if (entry.name.startsWith(AUTOSAVE_PREFIX)) continue;
    try {
      const raw = await fs.promises.readFile(path.join(PROJECTS_DIR, entry.name), 'utf-8');
      const p = JSON.parse(raw) as ProjectFile;
      if (!p.id || !p.templateName) continue;
      metas.push({
        id: p.id,
        name: p.name || p.id,
        templateName: p.templateName,
        editCount: countEdits(p.edits || {}),
        cssCount: countCss(p.cssEdits),
        createdAt: p.createdAt || 0,
        updatedAt: p.updatedAt || 0,
        templateExists: await templateExists(p.templateName)
      });
    } catch {
      // 损坏的草稿文件跳过
      continue;
    }
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  return metas;
}

async function templateExists(templateName: string): Promise<boolean> {
  // 同样禁止逃逸
  if (templateName.includes('..')) return false;
  try {
    const stat = await fs.promises.stat(path.join(TEMPLATES_DIR, templateName));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** 读取单个草稿（打开时用） */
export async function readProject(id: string): Promise<ProjectFile> {
  const raw = await fs.promises.readFile(projectPath(id), 'utf-8');
  return JSON.parse(raw) as ProjectFile;
}

/**
 * 新建或更新草稿。
 * 新建时 id 由名称生成并自动去重；源模板必须存在。
 */
export async function saveProject(args: SaveProjectArgs): Promise<ProjectMeta> {
  const name = (args.name || '').trim();
  if (!name) throw new Error('项目名称不能为空');
  if (!(await templateExists(args.templateName))) {
    throw new Error('源模板不存在，无法保存项目');
  }

  await fs.promises.mkdir(PROJECTS_DIR, { recursive: true });
  const now = Date.now();
  // 空对象不落盘字段，保持草稿干净
  const cssEdits =
    args.cssEdits && Object.keys(args.cssEdits).length > 0 ? args.cssEdits : undefined;
  const injections = normalizeInjections(args.injections);
  const structureByPage =
    args.structureByPage && Object.keys(args.structureByPage).length > 0
      ? args.structureByPage
      : undefined;
  const sharedEdits =
    args.sharedEdits && Object.keys(args.sharedEdits).length > 0 ? args.sharedEdits : undefined;

  let file: ProjectFile;
  if (args.id) {
    // 更新：必须读得到原文件，且保留创建时间与源模板
    const existing = await readProject(args.id);
    file = {
      ...existing,
      name,
      templateName: existing.templateName,
      edits: args.edits || {},
      cssEdits,
      injections,
      structureByPage,
      sharedEdits,
      updatedAt: now
    };
  } else {
    const baseId = sanitizeId(name);
    let id = baseId;
    let i = 1;
    while (true) {
      const exists = await fs.promises
        .access(projectPath(id))
        .then(() => true)
        .catch(() => false);
      if (!exists) break;
      id = `${baseId}-${i++}`;
    }
    file = {
      id,
      name,
      templateName: args.templateName,
      createdAt: now,
      updatedAt: now,
      edits: args.edits || {},
      cssEdits,
      injections,
      structureByPage,
      sharedEdits
    };
  }

  await fs.promises.writeFile(projectPath(file.id), JSON.stringify(file, null, 2), 'utf-8');

  return {
    id: file.id,
    name: file.name,
    templateName: file.templateName,
    editCount: countEdits(file.edits),
    cssCount: countCss(file.cssEdits),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    templateExists: true
  };
}

/** 删除草稿（不影响模板与导出文件）；非法 id 直接拒绝 */
export async function deleteProject(id: string): Promise<boolean> {
  const target = projectPath(id); // 非法 id 在此抛出，不被下面的 fs 容错吞掉
  try {
    await rmFileRobust(target);
    return true;
  } catch {
    return false;
  }
}

// =================== 自动草稿（每个工作区一份） ===================

function autosaveId(templateName: string): string {
  return AUTOSAVE_PREFIX + sanitizeId(templateName);
}

export interface AutosaveInfo {
  templateName: string;
  updatedAt: number;
  editCount: number;
  cssCount: number;
  injectionCount: number; // 自定义代码槽位数（head/body，0–2）
}

function countInjections(inj?: SiteInjections): number {
  if (!inj) return 0;
  return ((inj.head ?? '').trim() ? 1 : 0) + ((inj.body ?? '').trim() ? 1 : 0);
}

/** 读取某工作区的自动草稿信息（无则 null，损坏视为无） */
export async function getAutosave(templateName: string): Promise<AutosaveInfo | null> {
  try {
    const p = await readProject(autosaveId(templateName));
    return {
      templateName: p.templateName,
      updatedAt: p.updatedAt || 0,
      editCount: countEdits(p.edits || {}),
      cssCount: countCss(p.cssEdits),
      injectionCount: countInjections(p.injections)
    };
  } catch {
    return null;
  }
}

/** 读取自动草稿完整内容（恢复时用），结构与普通项目草稿一致 */
export async function readAutosaveFile(templateName: string): Promise<ProjectFile | null> {
  try {
    return await readProject(autosaveId(templateName));
  } catch {
    return null;
  }
}

/** 保存（覆盖）某工作区的自动草稿；内容、CSS、自定义代码均无差异时不写入 */
export async function saveAutosave(
  templateName: string,
  edits: ProjectFile['edits'],
  cssEdits?: ProjectFile['cssEdits'],
  injections?: SiteInjections,
  structureByPage?: StructureByPage,
  sharedEdits?: SharedEdits
): Promise<AutosaveInfo> {
  if (!(await templateExists(templateName))) {
    throw new Error('源模板不存在，无法自动保存');
  }
  const count = countEdits(edits || {});
  const css = cssEdits && Object.keys(cssEdits).length > 0 ? cssEdits : undefined;
  const cssCount = countCss(css);
  const inj = normalizeInjections(injections);
  const structure =
    structureByPage && Object.keys(structureByPage).length > 0 ? structureByPage : undefined;
  const shared =
    sharedEdits && Object.keys(sharedEdits).length > 0 ? sharedEdits : undefined;
  const id = autosaveId(templateName);
  const now = Date.now();
  const target = projectPath(id);

  if (count === 0 && cssCount === 0 && !inj && !structure && !shared) {
    // 没有任何差异：清掉旧自动草稿
    await rmFileRobust(target);
    return { templateName, updatedAt: 0, editCount: 0, cssCount: 0, injectionCount: 0 };
  }

  // 保留创建时间（若已存在）
  let createdAt = now;
  try {
    const old = JSON.parse(await fs.promises.readFile(target, 'utf-8')) as ProjectFile;
    createdAt = old.createdAt || now;
  } catch {
    // 新草稿
  }

  const file: ProjectFile = {
    id,
    name: `（自动保存）${templateName}`,
    templateName,
    createdAt,
    updatedAt: now,
    edits: edits || {},
    cssEdits: css,
    injections: inj,
    structureByPage: structure,
    sharedEdits: shared
  };
  await fs.promises.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.promises.writeFile(target, JSON.stringify(file, null, 2), 'utf-8');
  return {
    templateName,
    updatedAt: now,
    editCount: count,
    cssCount,
    injectionCount: countInjections(inj)
  };
}

/** 删除某工作区的自动草稿 */
export async function deleteAutosave(templateName: string): Promise<boolean> {
  try {
    await rmFileRobust(projectPath(autosaveId(templateName)));
    return true;
  } catch {
    return false;
  }
}

/**
 * 工作区重命名后：把所有引用旧名的草稿（含自动草稿）指向新名。
 * 返回更新的文件数量。
 */
export async function retargetProjects(oldName: string, newName: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return 0;
  }
  let touched = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(FILE_SUFFIX)) continue;
    const full = path.join(PROJECTS_DIR, entry.name);
    try {
      const p = JSON.parse(await fs.promises.readFile(full, 'utf-8')) as ProjectFile;
      if (p.templateName !== oldName) continue;
      p.templateName = newName;
      if (p.id.startsWith(AUTOSAVE_PREFIX)) {
        // 自动草稿的 id 由模板名派生，重写文件并改名
        const newId = autosaveId(newName);
        p.id = newId;
        await fs.promises.writeFile(full, JSON.stringify(p, null, 2), 'utf-8');
        await fs.promises.rename(full, projectPath(newId));
      } else {
        await fs.promises.writeFile(full, JSON.stringify(p, null, 2), 'utf-8');
      }
      touched++;
    } catch {
      // 损坏文件跳过
    }
  }
  return touched;
}

/** 删除指向某工作区的全部草稿（含自动草稿），返回删除数量 */
export async function deleteProjectsForTemplate(templateName: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(FILE_SUFFIX)) continue;
    const full = path.join(PROJECTS_DIR, entry.name);
    try {
      const p = JSON.parse(await fs.promises.readFile(full, 'utf-8')) as ProjectFile;
      if (p.templateName === templateName) {
        // 单个草稿被占用不应阻断模板删除；残留草稿会显示「源模板已删除」
        await rmFileRobust(full).catch(() => {});
        removed++;
      }
    } catch {
      // 损坏文件：若文件名对应该模板的自动草稿，也一并清理
      if (entry.name === `${autosaveId(templateName)}${FILE_SUFFIX}`) {
        await rmFileRobust(full).catch(() => {});
        removed++;
      }
    }
  }
  return removed;
}
