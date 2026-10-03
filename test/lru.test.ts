import { describe, it, expect } from 'vitest';
import { LruMap } from '../shared/lru';

describe('LruMap — 基础容量与淘汰', () => {
  it('未超容量时全部保留', () => {
    const m = new LruMap<string, number>(3);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);
    expect(m.size).toBe(3);
    expect([...m.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('超容量时淘汰最久未使用（插入序最旧）的项', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);
    expect([...m.keys()]).toEqual(['b', 'c']);
  });

  it('get 命中刷新为最近使用，旧项随后被淘汰', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    expect(m.get('a')).toBe(1); // a 刷新，b 变最旧
    m.set('c', 3);
    expect([...m.keys()]).toEqual(['a', 'c']);
  });

  it('get 未命中不改变顺序', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    expect(m.get('x')).toBeUndefined();
    m.set('c', 3);
    expect([...m.keys()]).toEqual(['b', 'c']);
  });

  it('重写已存在的键不增加容量且刷新位置', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    m.set('a', 10);
    expect(m.get('a')).toBe(10);
    m.set('c', 3);
    expect([...m.keys()]).toEqual(['a', 'c']);
  });

  it('capacity < 1 时按 1 处理', () => {
    const m = new LruMap<string, number>(0);
    m.set('a', 1);
    m.set('b', 2);
    expect(m.size).toBe(1);
    expect(m.get('a')).toBeUndefined();
    expect(m.get('b')).toBe(2);
  });
});

describe('LruMap — 受保护键', () => {
  it('canEvict 保护的键不被淘汰，优先淘汰其他最旧项', () => {
    const m = new LruMap<string, number>(2);
    m.set('keep-a', 1);
    m.set('drop-b', 2);
    // 写入新项时保护 keep-* 前缀：应淘汰 drop-b
    m.set('new-c', 3, (candidate) => !candidate.startsWith('keep-'));
    expect([...m.keys()]).toEqual(['keep-a', 'new-c']);
  });

  it('全部键受保护时退回纯 LRU，容量仍被严格限制', () => {
    const m = new LruMap<string, number>(2);
    m.set('keep-a', 1);
    m.set('keep-b', 2);
    m.set('keep-c', 3, () => false); // 谁都不让淘汰
    expect(m.size).toBe(2);
    expect([...m.keys()]).toEqual(['keep-b', 'keep-c']);
  });
});

describe('LruMap — 删除与谓词清理', () => {
  it('delete 返回是否存在', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    expect(m.delete('a')).toBe(true);
    expect(m.delete('a')).toBe(false);
    expect(m.has('a')).toBe(false);
  });

  it('deleteWhere 批量删除并返回数量，clear 清空', () => {
    const m = new LruMap<string, number>(5);
    m.set('t1/a', 1);
    m.set('t1/b', 2);
    m.set('t2/c', 3);
    expect(m.deleteWhere((k) => k.startsWith('t1/'))).toBe(2);
    expect([...m.keys()]).toEqual(['t2/c']);
    m.clear();
    expect(m.size).toBe(0);
  });
});
