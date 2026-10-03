// shared/shared-regions.ts
// 全站公共区（@wt:shared）纯逻辑：跨页同名 region 共享唯一权威值。
// 显示解析、编辑同步、草稿收集/恢复、全局替换调和都只走这里，保证多入口结果一致。

import type { Region } from './types/region';

/** 公共区草稿值：region id → 全站唯一值 */
export type SharedEdits = Record<string, string>;

/** 按页分组的 region 表 */
export type RegionsByPage = Record<string, Region[]>;

/**
 * 按 pages 顺序找每个公共区 id 的首次出现（页 + 值），作为权威来源。
 * pages 未列出的页面（理论上不该有）追加在末尾，保证不漏 id。
 */
export function sharedFirstOccurrence(
  pages: string[],
  regions: Region[]
): Map<string, { page: string; value: string }> {
  const first = new Map<string, { page: string; value: string }>();
  const visit = (page: string): void => {
    for (const r of regions) {
      if (r.page !== page || !r.shared || first.has(r.id)) continue;
      first.set(r.id, { page, value: r.value });
    }
  };
  for (const page of pages) visit(page);
  const known = new Set(pages);
  for (const r of regions) {
    if (!r.shared || known.has(r.page)) continue;
    visit(r.page);
  }
  return first;
}

/** 全部公共区 id 集合 */
export function listSharedIds(regions: Region[]): Set<string> {
  const ids = new Set<string>();
  for (const r of regions) if (r.shared) ids.add(r.id);
  return ids;
}

/**
 * 用「pages 顺序首次出现」的值统一所有页同名公共区（返回新 Region 数组）。
 * 主进程 parseWorkspace 的唯一权威值生成器：显示、编辑、导出都以它为准。
 */
export function unifySharedValues(pages: string[], regions: Region[]): Region[] {
  const first = sharedFirstOccurrence(pages, regions);
  if (first.size === 0) return regions;
  return regions.map((r) =>
    r.shared && r.value !== first.get(r.id)!.value
      ? { ...r, value: first.get(r.id)!.value }
      : r
  );
}

/**
 * 编辑一处公共区：把新值写入所有页面中同 id 的 region，返回新的按页表
 * （仅克隆受影响页；不包含该 id 的页保持原引用）。
 */
export function setSharedValue(
  byPage: RegionsByPage,
  id: string,
  value: string
): RegionsByPage {
  const next: RegionsByPage = {};
  let touched = false;
  for (const [page, list] of Object.entries(byPage)) {
    if (!list.some((r) => r.shared && r.id === id)) continue;
    touched = true;
    next[page] = list.map((r) =>
      r.shared && r.id === id && r.value !== value ? { ...r, value } : r
    );
  }
  return touched ? { ...byPage, ...next } : byPage;
}

/** 公共区 id → 出现在哪些页面（按 pages 顺序） */
export function sharedPageMap(pages: string[], byPage: RegionsByPage): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const page of pages) {
    for (const r of byPage[page] ?? []) {
      if (!r.shared) continue;
      const arr = map.get(r.id);
      if (arr) arr.push(page);
      else map.set(r.id, [page]);
    }
  }
  return map;
}

/**
 * 收集相对基线有改动的公共区权威值（取 pages 顺序首次出现页的值对比）。
 * 调用方在收集按页 edits 时必须跳过 shared region，避免双份存储不一致。
 */
export function collectSharedEdits(
  pages: string[],
  regionsByPage: RegionsByPage,
  baselineByPage: RegionsByPage
): SharedEdits {
  const current = sharedFirstOccurrence(pages, Object.values(regionsByPage).flat());
  const baseline = sharedFirstOccurrence(pages, Object.values(baselineByPage).flat());
  const out: SharedEdits = {};
  for (const [id, cur] of current) {
    const base = baseline.get(id);
    if (!base || base.value !== cur.value) out[id] = cur.value;
  }
  return out;
}

/**
 * 把公共区草稿值铺到所有含该 id 的页（返回新的按页表）；
 * 基线中不存在该 id（模板已移除标记）的草稿值忽略。
 */
export function applySharedEdits(
  byPage: RegionsByPage,
  edits: SharedEdits | undefined
): RegionsByPage {
  if (!edits) return byPage;
  const ids = Object.keys(edits);
  if (ids.length === 0) return byPage;
  const next: RegionsByPage = {};
  for (const [page, list] of Object.entries(byPage)) {
    if (!list.some((r) => r.shared && ids.includes(r.id))) continue;
    next[page] = list.map((r) =>
      r.shared && Object.prototype.hasOwnProperty.call(edits, r.id)
        ? { ...r, value: edits[r.id] }
        : r
    );
  }
  return Object.keys(next).length ? { ...byPage, ...next } : byPage;
}

/** 从按页 edits 中剔除公共区 id（恢复旧草稿时防止按页值与公共区权威值冲突） */
export function stripSharedFromEdits(
  edits: Record<string, Record<string, string>>,
  sharedIds: Set<string>
): Record<string, Record<string, string>> {
  if (sharedIds.size === 0) return edits;
  const out: Record<string, Record<string, string>> = {};
  for (const [page, map] of Object.entries(edits)) {
    const kept: Record<string, string> = {};
    for (const [id, value] of Object.entries(map)) {
      if (!sharedIds.has(id)) kept[id] = value;
    }
    if (Object.keys(kept).length > 0) out[page] = kept;
  }
  return out;
}

/** 判断某 id 是否为公共区（任一出现页带 shared 标志即认定） */
export function isSharedId(byPage: RegionsByPage, id: string): boolean {
  for (const list of Object.values(byPage)) {
    const hit = list.find((r) => r.id === id);
    if (hit) return !!hit.shared;
  }
  return false;
}

export interface SharedReconcileChange {
  id: string;
  oldValue: string;
  newValue: string;
  /** 首个发生变化的页（作为历史条目归属页） */
  page: string;
}

/**
 * 全局查找替换后的公共区调和：
 * 同一 shared id 在各页的替换结果可能不同（如某页没有匹配文本、大小写差异），
 * 取 pages 顺序中「首个相对原值发生变化」的新值作为权威，铺到所有出现页，
 * 保证替换后公共区仍然全站一致。nextByPage 只含替换中改过的页。
 */
export function reconcileSharedChanges(args: {
  pages: string[];
  prevByPage: RegionsByPage;
  nextByPage: RegionsByPage;
}): { patch: RegionsByPage; changes: SharedReconcileChange[] } {
  const { pages, prevByPage, nextByPage } = args;
  const sharedIds = listSharedIds(Object.values(prevByPage).flat());
  if (sharedIds.size === 0) return { patch: {}, changes: [] };

  const changes: SharedReconcileChange[] = [];
  const authoritative = new Map<string, { value: string; page: string }>();

  // pages 顺序中首个「变化页」的新值为权威
  for (const page of pages) {
    const changed = nextByPage[page];
    if (!changed) continue;
    const prevList = prevByPage[page] ?? [];
    for (const r of changed) {
      if (!r.shared || !sharedIds.has(r.id) || authoritative.has(r.id)) continue;
      const prev = prevList.find((x) => x.id === r.id);
      if (prev && prev.value !== r.value) {
        authoritative.set(r.id, { value: r.value, page });
      }
    }
  }
  if (authoritative.size === 0) return { patch: {}, changes: [] };

  // 权威值铺到所有出现页（含替换未命中的页）
  const patch: RegionsByPage = {};
  for (const [page, list] of Object.entries(prevByPage)) {
    if (!list.some((r) => r.shared && authoritative.has(r.id))) continue;
    patch[page] = list.map((r) =>
      r.shared && authoritative.has(r.id) ? { ...r, value: authoritative.get(r.id)!.value } : r
    );
  }

  for (const [id, { value, page }] of authoritative) {
    const first = sharedFirstOccurrence(pages, Object.values(prevByPage).flat()).get(id);
    changes.push({ id, oldValue: first?.value ?? '', newValue: value, page });
  }
  return { patch, changes };
}
