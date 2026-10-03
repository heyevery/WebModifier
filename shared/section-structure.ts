// shared/section-structure.ts
// 页面「区块结构」纯逻辑：块级标记区段（<!-- @wt:edit name="x" -->…<!-- /@wt:edit -->）
// 的复制 / 删除 / 排序。不写模板盘——结构只存在于会话与草稿中，显示与导出时
// 在干净基线 HTML 之上应用本变换。
//
// 模型：每页一份 SectionStructure.order —— 最终页面里区块实例的有序列表；
// sourceId 指向基线 HTML 中的原始区块（取其原始标记片段），id 是该实例的标记 id。
// 复制 = 新增一个 id 不同、sourceId 相同的实例（紧接源实例）；
// 删除 = 从 order 移除；上移/下移 = 交换相邻实例。

export interface SectionInstance {
  /** 该实例最终使用的区块标记 id（复制产生新 id） */
  id: string;
  /** 基线 HTML 中被克隆的原始区块 id */
  sourceId: string;
}

export interface SectionStructure {
  order: SectionInstance[];
}

/** 页面路径 → 该页结构（会话级） */
export type StructureByPage = Record<string, SectionStructure>;

interface BlockMatch {
  id: string;
  start: number;
  /** 闭区间结尾（exclusive），整段含首尾注释 */
  end: number;
  raw: string;
}

// 块标记：与 marker-parser 的 BLOCK_REGEX 保持同一语义，这里只需 id 与完整片段
const BLOCK_PATTERN =
  /<!--\s*@wt:edit\s+name="([^"]+)"[^>]*-->[\s\S]*?<!--\s*\/@wt:edit\s*-->/g;

/** 解析全部块级区段（按出现顺序）；attr 类标记不参与结构操作 */
export function parseBlocks(html: string): BlockMatch[] {
  const re = new RegExp(BLOCK_PATTERN);
  const blocks: BlockMatch[] = [];
  for (const m of html.matchAll(re)) {
    blocks.push({
      id: m[1],
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      raw: m[0]
    });
  }
  return blocks;
}

/** 由基线区块列表生成默认结构（每个原始区块一个同名实例） */
export function defaultStructure(blocks: BlockMatch[]): SectionStructure {
  return { order: blocks.map((b) => ({ id: b.id, sourceId: b.id })) };
}

/** 结构是否与基线一致（无删除/复制/重排），用于跳过处理 */
export function isDefaultStructure(html: string, structure: SectionStructure | undefined): boolean {
  if (!structure) return true;
  const blocks = parseBlocks(html);
  if (blocks.length !== structure.order.length) return false;
  return blocks.every((b, i) => {
    const inst = structure.order[i];
    return !!inst && inst.id === b.id && inst.sourceId === b.id;
  });
}

/**
 * 生成不冲突的复制区块 id：sourceId-copy、sourceId-copy2、…
 * used 需包含基线已有 id 与当前结构中的全部实例 id。
 */
export function nextSectionId(used: ReadonlySet<string>, sourceId: string): string {
  const base = `${sourceId}-copy`;
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  // 极端兜底：时间戳后缀
  return `${base}-${Date.now()}`;
}

/** 深复制前替换片段内全部标记 id：外层 name + 内层 data-wt-edit（同后缀） */
function withRenamedMarkers(raw: string, sourceId: string, instanceId: string): string {
  const suffix = instanceId.startsWith(sourceId)
    ? instanceId.slice(sourceId.length)
    : `-${instanceId}`;
  // 外层块注释只替换开注释里的第一个 name="sourceId"
  const nameAttr = `name="${sourceId}"`;
  const idx = raw.indexOf(nameAttr);
  let out = idx >= 0
    ? raw.slice(0, idx) + `name="${instanceId}"` + raw.slice(idx + nameAttr.length)
    : raw;
  // 内层嵌套的 attr 标记（区块内含其他可编辑元素）：全部加同后缀，避免 id 重复
  if (suffix) {
    out = out.replace(/\s+data-wt-edit="([^"]+)"/g, (full, innerId: string) => {
      if (innerId === sourceId) return ` data-wt-edit="${instanceId}"`;
      return ` data-wt-edit="${innerId}${suffix}"`;
    });
  }
  return out;
}

/**
 * 在基线 HTML 上应用结构变换，返回仍带标记的 HTML（随后照常走 parseTemplate / export）。
 * 槽位模型：N 个原始区块把页面切成 N+1 段「区块间内容」，这些内容原地保留；
 * M 个目标实例依次占据槽位——
 *   M ≤ N：前 M 个槽位放实例，多余槽位置空（删除）；
 *   M > N：超出的复制实例紧跟在其前驱实例同一槽位后输出（最终落在源实例旁边）。
 * structure 中引用了不存在 sourceId 的实例被忽略。
 */
export function applySectionStructure(
  html: string,
  structure: SectionStructure | undefined
): string {
  const blocks = parseBlocks(html);
  if (blocks.length === 0) return html;
  if (isDefaultStructure(html, structure)) return html;

  const rawById = new Map(blocks.map((b) => [b.id, b.raw]));
  const wanted = (structure?.order ?? []).filter((inst) => rawById.has(inst.sourceId));
  if (wanted.length === 0) {
    // 全部删除：仅丢弃区块片段，保留所有区块间内容拼接
    return spliceBlocks(html, blocks, () => '');
  }

  const n = blocks.length;
  // 每个槽位一个主实例；超出的复制实例记录到「前驱槽位」的附加队列
  const slotMain: (SectionInstance | null)[] = [];
  const slotExtras: SectionInstance[][] = Array.from({ length: n }, () => []);
  const slotOfInstance = new Map<number, number>();
  for (let i = 0; i < wanted.length; i++) {
    if (i < n) {
      slotMain.push(wanted[i]);
      slotOfInstance.set(i, i);
    } else {
      const prevSlot = slotOfInstance.get(i - 1);
      const anchor = prevSlot ?? n - 1;
      slotExtras[anchor].push(wanted[i]);
      slotOfInstance.set(i, anchor);
    }
  }
  while (slotMain.length < n) slotMain.push(null);

  const render = (inst: SectionInstance): string => {
    const raw = rawById.get(inst.sourceId) ?? '';
    return inst.id === inst.sourceId ? raw : withRenamedMarkers(raw, inst.sourceId, inst.id);
  };

  let out = html.slice(0, blocks[0].start);
  for (let i = 0; i < n; i++) {
    const main = slotMain[i];
    if (main) {
      out += render(main);
      for (const extra of slotExtras[i]) out += render(extra);
    }
    const segStart = blocks[i].end;
    const segEnd = i + 1 < n ? blocks[i + 1].start : html.length;
    out += html.slice(segStart, segEnd);
  }
  return out;
}

/** 用 renderFn 的结果替换每个区块片段（全部删除场景使用） */
function spliceBlocks(
  html: string,
  blocks: BlockMatch[],
  renderFn: (b: BlockMatch) => string
): string {
  let out = '';
  let lastEnd = 0;
  for (const b of blocks) {
    out += html.slice(lastEnd, b.start) + renderFn(b);
    lastEnd = b.end;
  }
  return out + html.slice(lastEnd);
}

// ---- 结构操作（供 store / IPC 复用的纯变更逻辑） ----

export function indexOfInstance(structure: SectionStructure, id: string): number {
  return structure.order.findIndex((inst) => inst.id === id);
}

/** 复制：在源实例后插入同 sourceId 的新实例，返回新 id（与新结构） */
export function duplicateInstance(
  structure: SectionStructure,
  sourceId: string,
  used: ReadonlySet<string>
): { structure: SectionStructure; newId: string } {
  const idx = indexOfInstance(structure, sourceId);
  if (idx < 0) return { structure, newId: '' };
  const newId = nextSectionId(used, structure.order[idx].sourceId);
  const order = structure.order.slice();
  order.splice(idx + 1, 0, { id: newId, sourceId: structure.order[idx].sourceId });
  return { structure: { order }, newId };
}

/** 移动：delta -1 上移 / +1 下移；越界或找不到时原样返回 */
export function moveInstance(
  structure: SectionStructure,
  id: string,
  delta: -1 | 1
): SectionStructure {
  const idx = indexOfInstance(structure, id);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= structure.order.length) return structure;
  const order = structure.order.slice();
  const [item] = order.splice(idx, 1);
  order.splice(target, 0, item);
  return { order };
}

/** 删除实例；删光后 order 为空（页面不再含任何区块） */
export function removeInstance(structure: SectionStructure, id: string): SectionStructure {
  return { order: structure.order.filter((inst) => inst.id !== id) };
}
