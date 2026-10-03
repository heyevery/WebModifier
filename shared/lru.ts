// shared/lru.ts
// 通用有界 LRU 映射：基于 Map 的插入序，get 命中即「删后重插」刷新为最近使用，
// set 超容量时淘汰最久未用项。调用方可在写入时提供 canEvict 保护键
// （例如协议缓存中，绝不能淘汰当前正在编辑模板的页面，否则 iframe 会丢失
// data-wt-rid 标记导致选中/框选失效）。

export class LruMap<K, V> {
  private readonly map = new Map<K, V>();

  /**
   * @param capacity 最大条目数（<1 时视为 1）
   */
  constructor(private readonly capacity: number) {
    if (capacity < 1) this.capacity = 1;
  }

  get size(): number {
    return this.map.size;
  }

  /** 读命中会把该项刷新为最近使用；未命中返回 undefined */
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * 写入（已存在则刷新位置与值）。超容量时：
   * 1. 优先淘汰 canEvict 返回 false 以外的最旧项；
   * 2. 若全部受保护，则退回纯 LRU 淘汰最旧项（保证容量不被突破）。
   */
  set(key: K, value: V, canEvict?: (candidate: K, incomingKey: K) => boolean): void {
    this.map.delete(key);
    while (this.map.size >= this.capacity) {
      let victim: K | undefined;
      if (canEvict) {
        for (const candidate of this.map.keys()) {
          if (canEvict(candidate, key)) {
            victim = candidate;
            break;
          }
        }
      }
      if (victim === undefined) victim = this.map.keys().next().value as K | undefined;
      if (victim === undefined) break;
      this.map.delete(victim);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /** 删除所有满足谓词的键，返回删除数量（用于按模板名前缀批量清理） */
  deleteWhere(predicate: (key: K) => boolean): number {
    let removed = 0;
    for (const key of [...this.map.keys()]) {
      if (predicate(key)) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.map.clear();
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }
}
