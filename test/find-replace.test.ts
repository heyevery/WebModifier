import { describe, it, expect } from 'vitest';
import {
  findInRegions,
  replaceInRegions,
  countOccurrences,
  replaceLiteral
} from '../shared/find-replace';
import type { Region } from '../shared/types/region';

function region(over: Partial<Region> & Pick<Region, 'type' | 'value' | 'page' | 'id'>): Region {
  return {
    kind: 'attr',
    label: over.id,
    anchorRids: [],
    ...over
  };
}

const CS = { caseSensitive: true };
const CI = { caseSensitive: false };

describe('countOccurrences / replaceLiteral', () => {
  it('非重叠计数', () => {
    expect(countOccurrences('aaa', 'aa', CS)).toBe(1); // split 语义
    expect(countOccurrences('a-a-a', 'a', CS)).toBe(3);
    expect(countOccurrences('abc', '', CS)).toBe(0);
  });

  it('大小写选项', () => {
    expect(countOccurrences('AbcABCabc', 'abc', CS)).toBe(1);
    expect(countOccurrences('AbcABCabc', 'abc', CI)).toBe(3);
    expect(replaceLiteral('AbcABC', 'abc', 'X', CI)).toBe('XX');
    expect(replaceLiteral('AbcABC', 'abc', 'X', CS)).toBe('AbcABC');
    expect(replaceLiteral('abcABC', 'abc', 'X', CS)).toBe('XABC');
  });
});

describe('findInRegions / replaceInRegions — 纯文本类', () => {
  it('text/button/richtext/html 整体作为文本查找替换', () => {
    const list = [
      region({ id: 'a', page: 'index.html', type: 'text', value: '旧公司 欢迎来到旧公司' }),
      region({ id: 'b', page: 'index.html', type: 'richtext', value: '<p>旧公司 <strong>旧公司</strong></p>' }),
      region({ id: 'c', page: 'index.html', type: 'spacer', value: '20px' })
    ];
    const hits = findInRegions(list, '旧公司', CS);
    expect(hits.map((h) => h.regionId)).toEqual(['a', 'b']);
    expect(hits[0].count).toBe(2);
    // 片段去除标签
    expect(hits[1].snippet).toContain('旧公司 旧公司');

    const res = replaceInRegions(list, '旧公司', '新集团', CS);
    expect(res.totalCount).toBe(4);
    expect(res.changed.map((c) => c.regionId)).toEqual(['a', 'b']);
    expect(res.regions[0].value).toBe('新集团 欢迎来到新集团');
    expect(res.regions[1].value).toBe('<p>新集团 <strong>新集团</strong></p>');
    expect(res.regions[2]).toBe(list[2]); // 未命中保持原引用
  });
});

describe('find/replace — JSON 类字段', () => {
  it('link 同时改文字与 href（tel: 场景）', () => {
    const r = region({
      id: 'tel',
      page: 'index.html',
      type: 'link',
      value: JSON.stringify({ href: 'tel:13900000000', text: '电话：13900000000' })
    });
    const hits = findInRegions([r], '13900000000', CS);
    expect(hits[0].count).toBe(2);
    const res = replaceInRegions([r], '13900000000', '13811111111', CS);
    const v = JSON.parse(res.regions[0].value);
    expect(v).toEqual({ href: 'tel:13811111111', text: '电话：13811111111' });
  });

  it('image 只改 alt，不碰 src', () => {
    const r = region({
      id: 'logo',
      page: 'index.html',
      type: 'image',
      value: JSON.stringify({ src: 'assets/旧公司/logo.png', alt: '旧公司 Logo' })
    });
    const res = replaceInRegions([r], '旧公司', '新集团', CS);
    const v = JSON.parse(res.regions[0].value);
    expect(v.src).toBe('assets/旧公司/logo.png');
    expect(v.alt).toBe('新集团 Logo');
  });

  it('list 数组逐项替换', () => {
    const r = region({
      id: 'l',
      page: 'index.html',
      type: 'list',
      value: JSON.stringify(['旧公司业务', '与旧公司无关', '其他'])
    });
    const res = replaceInRegions([r], '旧公司', '新集团', CS);
    expect(JSON.parse(res.regions[0].value)).toEqual(['新集团业务', '与新集团无关', '其他']);
    expect(res.changed[0].count).toBe(2);
  });

  it('input/textarea 改 placeholder/value；checkbox 改 label', () => {
    const input = region({
      id: 'i', page: 'p.html', type: 'input',
      value: JSON.stringify({ type: 'text', placeholder: '搜索旧公司', value: '旧公司' })
    });
    const cb = region({
      id: 'c', page: 'p.html', type: 'checkbox',
      value: JSON.stringify({ checked: false, label: '同意旧公司条款' })
    });
    const res = replaceInRegions([input, cb], '旧公司', '新集团', CS);
    expect(JSON.parse(res.regions[0].value).placeholder).toBe('搜索新集团');
    expect(JSON.parse(res.regions[0].value).value).toBe('新集团');
    expect(JSON.parse(res.regions[1].value).label).toBe('同意新集团条款');
  });

  it('select 改选项 label/value 并保留其它字段', () => {
    const r = region({
      id: 's', page: 'p.html', type: 'select',
      value: JSON.stringify({ options: [{ label: '旧公司', value: '旧' }, { label: '别家', value: 'x' }], value: '旧' })
    });
    const res = replaceInRegions([r], '旧公司', '新集团', CS);
    const v = JSON.parse(res.regions[0].value);
    expect(v.options[0]).toEqual({ label: '新集团', value: '旧' });
    expect(v.value).toBe('旧');
  });

  it('color/custom-css/video 等类型不参与', () => {
    const list = [
      region({ id: 'x1', page: 'p.html', type: 'color', value: JSON.stringify({ prop: 'color', value: '旧公司' }) }),
      region({ id: 'x2', page: 'p.html', type: 'video', value: JSON.stringify({ src: '旧公司.mp4', poster: 'p.jpg' }) })
    ];
    expect(findInRegions(list, '旧公司', CS)).toHaveLength(0);
    expect(replaceInRegions(list, '旧公司', '新集团', CS).changed).toHaveLength(0);
  });

  it('非法 JSON 值安全跳过', () => {
    const r = region({ id: 'bad', page: 'p.html', type: 'link', value: '{not json' });
    expect(findInRegions([r], 'x', CS)).toHaveLength(0);
    const res = replaceInRegions([r], 'x', 'y', CS);
    expect(res.regions[0].value).toBe('{not json');
  });
});

describe('跨页面聚合', () => {
  it('命中按入参顺序返回并带 page/label/type', () => {
    const list = [
      region({ id: 'a', page: 'index.html', type: 'text', label: '标题', value: 'Acme' }),
      region({ id: 'b', page: 'about/index.html', type: 'button', value: '联系 ACME' })
    ];
    const hits = findInRegions(list, 'acme', CI);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ page: 'index.html', label: '标题', count: 1 });
    expect(hits[1].page).toBe('about/index.html');
  });

  it('空查询不匹配不替换', () => {
    const list = [region({ id: 'a', page: 'p.html', type: 'text', value: 'x' })];
    expect(findInRegions(list, '', CS)).toEqual([]);
    expect(replaceInRegions(list, '', 'y', CS).totalCount).toBe(0);
  });
});
