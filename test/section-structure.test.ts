// test/section-structure.test.ts
import { describe, expect, it } from 'vitest';
import {
  applySectionStructure,
  defaultStructure,
  duplicateInstance,
  indexOfInstance,
  isDefaultStructure,
  moveInstance,
  nextSectionId,
  parseBlocks,
  removeInstance,
  type SectionStructure
} from '@shared/section-structure';

const HTML = [
  '<html><body>',
  '<!-- @wt:edit name="hero" type="text" --><section><h1>标题</h1></section><!-- /@wt:edit -->',
  '<p>区块间内容</p>',
  '<!-- @wt:edit name="features" type="richtext" --><div><h2>特性</h2></div><!-- /@wt:edit -->',
  '<!-- @wt:edit name="cta" type="button" --><button>Go</button><!-- /@wt:edit -->',
  '</body></html>'
].join('');

const open = (id: string, extra = '') =>
  `<!-- @wt:edit name="${id}"${extra}-->`;

describe('parseBlocks / defaultStructure', () => {
  it('按出现顺序识别全部块级区段并给出完整区间', () => {
    const blocks = parseBlocks(HTML);
    expect(blocks.map((b) => b.id)).toEqual(['hero', 'features', 'cta']);
    expect(HTML.slice(blocks[0].start, blocks[0].end)).toContain('<h1>标题</h1>');
  });

  it('attr 类单元素标记不算区块', () => {
    const html = '<div data-wt-edit="x" data-wt-type="text">A</div>';
    expect(parseBlocks(html)).toHaveLength(0);
  });

  it('默认结构恒等', () => {
    const s = defaultStructure(parseBlocks(HTML));
    expect(s.order).toEqual([
      { id: 'hero', sourceId: 'hero' },
      { id: 'features', sourceId: 'features' },
      { id: 'cta', sourceId: 'cta' }
    ]);
    expect(isDefaultStructure(HTML, s)).toBe(true);
  });
});

describe('nextSectionId', () => {
  it('依次生成 -copy / -copy2 / -copy3', () => {
    const used = new Set(['hero']);
    const a = nextSectionId(used, 'hero');
    expect(a).toBe('hero-copy');
    used.add(a);
    const b = nextSectionId(used, 'hero');
    expect(b).toBe('hero-copy2');
  });
});

describe('applySectionStructure', () => {
  it('undefined / 默认结构时原样返回', () => {
    expect(applySectionStructure(HTML, undefined)).toBe(HTML);
  });

  it('删除中间区块：标记片段消失，区块间内容保留', () => {
    const s: SectionStructure = {
      order: [
        { id: 'hero', sourceId: 'hero' },
        { id: 'cta', sourceId: 'cta' }
      ]
    };
    const out = applySectionStructure(HTML, s);
    expect(out).not.toContain('name="features"');
    expect(out).toContain('<p>区块间内容</p>');
    expect(out).toContain('name="hero"');
    expect(out).toContain('name="cta"');
    // 其余两个区块的闭合注释都还在
    expect(out.match(/\/@wt:edit/g)).toHaveLength(2);
  });

  it('全部删除时保留区块间内容', () => {
    const out = applySectionStructure(HTML, { order: [] });
    expect(out).not.toContain('@wt:edit');
    expect(out).toContain('<p>区块间内容</p>');
    expect(out).toContain('</body></html>');
  });

  it('交换顺序：槽位内容互换，页面首尾与间隔内容不动', () => {
    const s: SectionStructure = {
      order: [
        { id: 'features', sourceId: 'features' },
        { id: 'hero', sourceId: 'hero' },
        { id: 'cta', sourceId: 'cta' }
      ]
    };
    const out = applySectionStructure(HTML, s);
    const iHero = out.indexOf('name="hero"');
    const iFeat = out.indexOf('name="features"');
    const iGap = out.indexOf('<p>区块间内容</p>');
    expect(iFeat).toBeLessThan(iGap);
    expect(iGap).toBeLessThan(iHero);
    expect(out.startsWith('<html><body>')).toBe(true);
    expect(out.endsWith('</body></html>')).toBe(true);
  });

  it('复制：新实例标记 id 改写并紧邻源实例，type/label 属性保留', () => {
    const s: SectionStructure = {
      order: [
        { id: 'hero', sourceId: 'hero' },
        { id: 'hero-copy', sourceId: 'hero' },
        { id: 'features', sourceId: 'features' },
        { id: 'cta', sourceId: 'cta' }
      ]
    };
    const out = applySectionStructure(HTML, s);
    expect(out).toContain(open('hero', ' type="text" '));
    expect(out).toContain(open('hero-copy', ' type="text" '));
    expect(out.match(/name="hero/g)).toHaveLength(2);
    expect(out).toContain('<h1>标题</h1></section><!-- /@wt:edit -->'.replace('标题', '标题'));
    // 复制的内容也在
    expect(out.match(/<h1>标题<\/h1>/g)).toHaveLength(2);
  });

  it('复制时内层 attr 标记 id 同步加后缀，避免重复 id', () => {
    const html =
      open('card', ' type="richtext" ') +
      '<section><span data-wt-edit="card-title" data-wt-type="text">A</span></section>' +
      '<!-- /@wt:edit -->';
    const s: SectionStructure = {
      order: [
        { id: 'card', sourceId: 'card' },
        { id: 'card-copy', sourceId: 'card' }
      ]
    };
    const out = applySectionStructure(html, s);
    expect(out).toContain('data-wt-edit="card-title"');
    expect(out).toContain('data-wt-edit="card-title-copy"');
  });

  it('引用不存在 sourceId 的实例被忽略', () => {
    const s: SectionStructure = {
      order: [
        { id: 'hero', sourceId: 'hero' },
        { id: 'ghost', sourceId: 'ghost' },
        { id: 'features', sourceId: 'features' },
        { id: 'cta', sourceId: 'cta' }
      ]
    };
    const out = applySectionStructure(HTML, s);
    expect(out).not.toContain('ghost');
    expect(isDefaultStructure(out, defaultStructure(parseBlocks(out)))).toBe(true);
  });
});

describe('结构操作纯函数', () => {
  const base = defaultStructure(parseBlocks(HTML));

  it('duplicateInstance 在源实例后插入并返回新 id', () => {
    const used = new Set(base.order.map((i) => i.id));
    const { structure, newId } = duplicateInstance(base, 'hero', used);
    expect(newId).toBe('hero-copy');
    expect(structure.order.map((i) => i.id)).toEqual([
      'hero',
      'hero-copy',
      'features',
      'cta'
    ]);
    expect(structure.order[1].sourceId).toBe('hero');
  });

  it('moveInstance 上移/下移与越界保护', () => {
    const down = moveInstance(base, 'hero', 1);
    expect(down.order.map((i) => i.id)).toEqual(['features', 'hero', 'cta']);
    const up = moveInstance(down, 'hero', -1);
    expect(up.order.map((i) => i.id)).toEqual(['hero', 'features', 'cta']);
    expect(moveInstance(base, 'hero', -1)).toBe(base);
  });

  it('removeInstance 删除后再应用，区块不可见', () => {
    const removed = removeInstance(base, 'features');
    expect(indexOfInstance(removed, 'features')).toBe(-1);
    const out = applySectionStructure(HTML, removed);
    expect(out).not.toContain('特性');
  });
});
