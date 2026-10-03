import { describe, it, expect } from 'vitest';
import type { Region } from '@shared/types/region';
import {
  applySharedEdits,
  collectSharedEdits,
  isSharedId,
  listSharedIds,
  reconcileSharedChanges,
  setSharedValue,
  sharedPageMap,
  stripSharedFromEdits,
  unifySharedValues,
  type RegionsByPage
} from '@shared/shared-regions';

function region(partial: Partial<Region> & Pick<Region, 'id' | 'page' | 'value'>): Region {
  return {
    kind: 'block',
    type: 'text',
    anchorRids: [`${partial.id}-0`],
    ...partial
  };
}

function byPage(input: Record<string, Array<[string, string, boolean?]>>): RegionsByPage {
  const out: RegionsByPage = {};
  for (const [page, items] of Object.entries(input)) {
    out[page] = items.map(([id, value, shared]) =>
      region({ id, page, value, shared: shared || undefined })
    );
  }
  return out;
}

describe('shared-regions', () => {
  it('unifySharedValues: 以 pages 顺序首次出现的值为权威，统一所有页', () => {
    const pages = ['index.html', 'about/index.html'];
    const regions = [
      region({ id: 'nav', page: 'index.html', value: 'A', shared: true }),
      region({ id: 'nav', page: 'about/index.html', value: 'B', shared: true }),
      region({ id: 'local', page: 'index.html', value: 'X' })
    ];
    const out = unifySharedValues(pages, regions);
    expect(out.find((r) => r.id === 'nav' && r.page === 'about/index.html')?.value).toBe('A');
    expect(out.find((r) => r.id === 'local')?.value).toBe('X');
    // 无公共区时原样返回
    expect(unifySharedValues(pages, [region({ id: 'x', page: 'index.html', value: '1' })])).toHaveLength(1);
  });

  it('unifySharedValues: index.html 永远权威（pages 已排好序传入）', () => {
    const pages = ['index.html', 'b.html'];
    const regions = [
      region({ id: 's1', page: 'b.html', value: 'from-b', shared: true }),
      region({ id: 's1', page: 'index.html', value: 'from-a', shared: true })
    ];
    const out = unifySharedValues(pages, regions);
    expect(out.every((r) => r.value === 'from-a')).toBe(true);
  });

  it('listSharedIds / sharedPageMap', () => {
    const table = byPage({
      'index.html': [['nav', 'A', true], ['hero', 'H']],
      'about.html': [['nav', 'A', true]]
    });
    const all = Object.values(table).flat();
    expect([...listSharedIds(all)]).toEqual(['nav']);
    const map = sharedPageMap(['index.html', 'about.html'], table);
    expect(map.get('nav')).toEqual(['index.html', 'about.html']);
    expect(isSharedId(table, 'nav')).toBe(true);
    expect(isSharedId(table, 'hero')).toBe(false);
  });

  it('setSharedValue: 更新所有出现页，未涉及页保持引用', () => {
    const table = byPage({
      'index.html': [['nav', 'A', true], ['hero', 'H']],
      'about.html': [['nav', 'A', true]],
      'other.html': [['x', '1']]
    });
    const next = setSharedValue(table, 'nav', 'B');
    expect(next['index.html'].find((r) => r.id === 'nav')?.value).toBe('B');
    expect(next['about.html'].find((r) => r.id === 'nav')?.value).toBe('B');
    expect(next['index.html'].find((r) => r.id === 'hero')?.value).toBe('H');
    expect(next['other.html']).toBe(table['other.html']);
    // 不存在的 id 原样返回
    expect(setSharedValue(table, 'nope', 'Z')).toBe(table);
  });

  it('collectSharedEdits: 只收集权威值相对基线变化的公共区', () => {
    const pages = ['index.html', 'about.html'];
    const current = byPage({
      'index.html': [['nav', 'NEW', true], ['keep', 'SAME', true]],
      'about.html': [['nav', 'NEW', true], ['keep', 'SAME', true]]
    });
    const baseline = byPage({
      'index.html': [['nav', 'OLD', true], ['keep', 'SAME', true]],
      'about.html': [['nav', 'OLD', true], ['keep', 'SAME', true]]
    });
    const edits = collectSharedEdits(pages, current, baseline);
    expect(edits).toEqual({ nav: 'NEW' });
    // 基线缺该 id（模板新加标记）也要收集
    const edits2 = collectSharedEdits(pages, current, { 'index.html': [], 'about.html': [] });
    expect(edits2.nav).toBe('NEW');
    expect(edits2.keep).toBe('SAME');
  });

  it('applySharedEdits: 草稿值铺到所有页；基线不存在的 id 忽略', () => {
    const table = byPage({
      'index.html': [['nav', 'OLD', true]],
      'about.html': [['nav', 'OLD', true], ['p', 'x']]
    });
    const next = applySharedEdits(table, { nav: 'DRAFT', ghost: 'G' });
    expect(next['index.html'].find((r) => r.id === 'nav')?.value).toBe('DRAFT');
    expect(next['about.html'].find((r) => r.id === 'nav')?.value).toBe('DRAFT');
    expect(applySharedEdits(table, undefined)).toBe(table);
    expect(applySharedEdits(table, {})).toBe(table);
    expect(applySharedEdits(table, { ghost: 'G' })).toBe(table);
  });

  it('stripSharedFromEdits: 从按页 edits 剔除公共区 id', () => {
    const edits = {
      'index.html': { nav: 'A', hero: 'H' },
      'about.html': { nav: 'A' }
    };
    const out = stripSharedFromEdits(edits, new Set(['nav']));
    expect(out).toEqual({ 'index.html': { hero: 'H' } });
    expect(stripSharedFromEdits(edits, new Set())).toBe(edits);
  });

  it('reconcileSharedChanges: 某页未命中替换时以首个变化页的值统一', () => {
    const pages = ['index.html', 'about.html'];
    const prev = byPage({
      'index.html': [['nav', 'Hello', true], ['body', 'hello world']],
      'about.html': [['nav', 'Hello', true], ['body', 'nothing here']]
    });
    // 仅 index 页的 nav 与 body 命中替换；about 的 nav 未命中
    const nextByPage: RegionsByPage = {
      'index.html': [
        region({ id: 'nav', page: 'index.html', value: 'Hi', shared: true }),
        region({ id: 'body', page: 'index.html', value: 'Hi world' })
      ]
    };
    const { patch, changes } = reconcileSharedChanges({ pages, prevByPage: prev, nextByPage });
    // about 页 nav 被强制同步为 Hi（即使该页没命中）
    expect(patch['about.html'].find((r) => r.id === 'nav')?.value).toBe('Hi');
    expect(patch['index.html'].find((r) => r.id === 'body')?.value).toBe('hello world'); // 非公共区不动
    expect(changes).toEqual([{ id: 'nav', oldValue: 'Hello', newValue: 'Hi', page: 'index.html' }]);
  });

  it('reconcileSharedChanges: 无公共区/无变化时返回空', () => {
    const prev = byPage({ 'index.html': [['a', 'x']] });
    expect(reconcileSharedChanges({ pages: ['index.html'], prevByPage: prev, nextByPage: {} }).changes).toEqual([]);
  });
});
