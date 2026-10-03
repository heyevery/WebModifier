import { describe, it, expect } from 'vitest';
import { parseTemplate } from '../electron/main/services/marker-parser';
import type { WTConfig } from '../shared/types/region';

const PAGE = 'index.html';

describe('parseTemplate — 块级注释标记', () => {
  it('提取文本区域并注入 data-wt-rid', () => {
    const html = '<h1><!-- @wt:edit name="title" label="主标题" --><span>Hello</span><!-- /@wt:edit --></h1>';
    const { regions, displayHtml } = parseTemplate(html, null, PAGE);

    expect(regions).toHaveLength(1);
    const r = regions[0];
    expect(r).toMatchObject({
      id: 'title',
      kind: 'block',
      type: 'text',
      label: '主标题',
      page: PAGE,
      value: 'Hello',
      anchorRids: ['title-0']
    });
    // 显示用 HTML：注释被剥掉，首元素带上 rid
    expect(displayHtml).toContain('data-wt-rid="title-0"');
    expect(displayHtml).not.toContain('@wt:edit');
    expect(displayHtml).toContain('<span data-wt-rid="title-0">Hello</span>');
  });

  it('block link 提取为 {href,text} JSON', () => {
    const html =
      '<!-- @wt:edit name="cta" type="link" label="行动按钮" --><a href="/signup/">立即开始</a><!-- /@wt:edit -->';
    const { regions } = parseTemplate(html, null, PAGE);
    expect(regions[0].type).toBe('link');
    expect(JSON.parse(regions[0].value)).toEqual({ href: '/signup/', text: '立即开始' });
  });
});

describe('parseTemplate — 属性标记', () => {
  it('常规元素 attr text：剥离标记并以 rid 替代', () => {
    const html = '<p data-wt-edit="slogan" data-wt-label="标语">原始标语</p>';
    const { regions, displayHtml } = parseTemplate(html, null, PAGE);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      id: 'slogan',
      kind: 'attr',
      type: 'text',
      value: '原始标语'
    });
    expect(displayHtml).toBe('<p data-wt-rid="slogan-0">原始标语</p>');
  });

  it('void 元素 img：提取 {src,alt}，显示 HTML 仍为无闭合标签', () => {
    const html = '<img data-wt-edit="logo" data-wt-type="image" src="a.png" alt="Logo">';
    const { regions, displayHtml } = parseTemplate(html, null, PAGE);
    expect(regions[0].type).toBe('image');
    expect(JSON.parse(regions[0].value)).toEqual({ src: 'a.png', alt: 'Logo' });
    expect(displayHtml).toContain('data-wt-rid="logo-0"');
    expect(displayHtml).toContain('src="a.png"');
    expect(displayHtml).not.toContain('data-wt-edit');
  });

  it('同页多个标记按文档顺序返回', () => {
    const html =
      '<p data-wt-edit="a">A</p><p data-wt-edit="b">B</p><p data-wt-edit="c">C</p>';
    const { regions } = parseTemplate(html, null, PAGE);
    expect(regions.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('config.editable 默认值优先于 HTML 提取值', () => {
    const html = '<p data-wt-edit="slogan">HTML 中的值</p>';
    const config: WTConfig = {
      name: 't',
      version: '1.0.0',
      editable: { slogan: { type: 'text', default: '配置里的默认值' } }
    };
    const { regions } = parseTemplate(html, config, PAGE);
    expect(regions[0].value).toBe('配置里的默认值');
  });

  it('link 默认值兼容旧格式纯字符串（文字沿用 HTML）', () => {
    const html = '<a data-wt-edit="more" data-wt-type="link" href="old.html">了解更多</a>';
    const config: WTConfig = {
      name: 't',
      version: '1.0.0',
      editable: { more: { type: 'link', default: 'new.html' } }
    };
    const { regions } = parseTemplate(html, config, PAGE);
    expect(JSON.parse(regions[0].value)).toEqual({ href: 'new.html', text: '了解更多' });
  });
});

describe('parseTemplate — 多页归属', () => {
  it('region.page 使用传入的页面路径', () => {
    const html = '<p data-wt-edit="x">X</p>';
    const { regions } = parseTemplate(html, null, 'about/index.html');
    expect(regions[0].page).toBe('about/index.html');
  });
});

describe('parseTemplate — 全站公共区 @wt:shared', () => {
  it('块级 shared 标记：region.shared=true，显示 HTML 剥注释注 rid', () => {
    const html =
      '<!-- @wt:shared name="nav-brand" type="text" label="导航品牌" --><a class="brand">ACME</a><!-- /@wt:shared -->';
    const { regions, displayHtml } = parseTemplate(html, null, PAGE);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      id: 'nav-brand',
      kind: 'block',
      type: 'text',
      label: '导航品牌',
      page: PAGE,
      value: 'ACME',
      shared: true
    });
    expect(displayHtml).not.toContain('@wt:shared');
    expect(displayHtml).toContain('data-wt-rid="nav-brand-0"');
  });

  it('属性 shared 标记（含 void 元素）：shared=true 且以 rid 替代', () => {
    const html =
      '<img data-wt-shared="site-logo" data-wt-type="image" src="logo.png" alt="Logo">';
    const { regions, displayHtml } = parseTemplate(html, null, PAGE);
    expect(regions[0]).toMatchObject({
      id: 'site-logo',
      kind: 'attr',
      type: 'image',
      shared: true
    });
    expect(displayHtml).not.toContain('data-wt-shared');
    expect(displayHtml).toContain('data-wt-rid="site-logo-0"');
    expect(displayHtml).toContain('src="logo.png"');
  });

  it('同页 edit 与 shared 标记并存且按文档顺序输出', () => {
    const html =
      '<p data-wt-shared="brand">B</p><p data-wt-edit="local">L</p>' +
      '<!-- @wt:shared name="foot" --><span>F</span><!-- /@wt:shared -->';
    const { regions } = parseTemplate(html, null, PAGE);
    expect(regions.map((r) => r.id)).toEqual(['brand', 'local', 'foot']);
    expect(regions.map((r) => !!r.shared)).toEqual([true, false, true]);
  });
});
