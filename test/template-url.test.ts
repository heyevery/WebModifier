import { describe, it, expect } from 'vitest';
import {
  buildTemplateUrl,
  relativePageHref,
  resolveKnownPage,
  resolvePagePath,
  rewritePageHrefs
} from '../shared/template-url';

describe('buildTemplateUrl', () => {
  it('中文模板名与空格路径逐段编码', () => {
    const url = buildTemplateUrl('我的网站', 'about me/index.html');
    expect(url).toBe('wt-template://%E6%88%91%E7%9A%84%E7%BD%91%E7%AB%99/about%20me/index.html');
  });

  it('缓存戳通过查询串附加', () => {
    expect(buildTemplateUrl('t', 'index.html', 42)).toContain('?wt-t=42');
    expect(buildTemplateUrl('t', 'index.html')).not.toContain('?');
  });
});

describe('resolvePagePath', () => {
  it('根页相对路径', () => {
    expect(resolvePagePath('index.html', 'about/index.html')).toBe('about/index.html');
  });

  it('子目录中的同级与跨级相对路径', () => {
    expect(resolvePagePath('about/index.html', 'team/index.html')).toBe('about/team/index.html');
    expect(resolvePagePath('about/team/index.html', '../index.html')).toBe('about/index.html');
    expect(resolvePagePath('a/b/index.html', '../../contact/index.html')).toBe(
      'contact/index.html'
    );
  });

  it('根相对路径去掉前导斜杠', () => {
    expect(resolvePagePath('deep/page.html', '/news/index.html')).toBe('news/index.html');
  });

  it('查询串与锚点被剥离；纯锚点返回当前页', () => {
    expect(resolvePagePath('about/index.html', 'team/index.html#top?x=1')).toBe(
      'about/team/index.html'
    );
    expect(resolvePagePath('about/index.html', '#section-2')).toBe('about/index.html');
  });

  it('目录式链接（以 / 结尾）按目录入口 index.html 解析', () => {
    expect(resolvePagePath('index.html', 'about/')).toBe('about/index.html');
    expect(resolvePagePath('index.html', '/about/')).toBe('about/index.html');
    expect(resolvePagePath('news/index.html', '../about/')).toBe('about/index.html');
    expect(resolvePagePath('about/index.html', './')).toBe('about/index.html');
    expect(resolvePagePath('index.html', '/')).toBe('index.html');
  });
});

describe('resolveKnownPage', () => {
  const pages = ['index.html', 'about/index.html', 'contact.html'];

  it('直接命中', () => {
    expect(resolveKnownPage('index.html', 'about/index.html', pages)).toBe('about/index.html');
  });

  it('无扩展名目录名命中 <dir>/index.html', () => {
    expect(resolveKnownPage('index.html', 'about', pages)).toBe('about/index.html');
    expect(resolveKnownPage('index.html', '/about', pages)).toBe('about/index.html');
  });

  it('省扩展名命中 <name>.html', () => {
    expect(resolveKnownPage('index.html', 'contact', pages)).toBe('contact.html');
  });

  it('任何页面都对应不上时返回 null', () => {
    expect(resolveKnownPage('index.html', 'nope', pages)).toBeNull();
  });
});

describe('relativePageHref', () => {
  it('根页面直接使用目标相对路径', () => {
    expect(relativePageHref('index.html', 'about/index.html')).toBe('about/index.html');
  });

  it('子页面生成正确的 ../ 前缀', () => {
    expect(relativePageHref('about/index.html', 'contact/index.html')).toBe(
      '../contact/index.html'
    );
    expect(relativePageHref('a/b/index.html', 'index.html')).toBe('../../index.html');
  });
});

describe('rewritePageHrefs', () => {
  it('根页中的子页链接：重命名后改写并保留锚点/查询串', () => {
    const html = '<a href="about/index.html#team">About</a>';
    const out = rewritePageHrefs(html, 'index.html', 'about/index.html', 'about-us/index.html');
    expect(out).toBe('<a href="about-us/index.html#team">About</a>');
  });

  it('子页中的跨级目录链接（../）正确改写', () => {
    const html = '<a href=\'../contact/index.html?x=1\'>Contact</a>';
    const out = rewritePageHrefs(
      html,
      'about/index.html',
      'contact/index.html',
      'reach/index.html'
    );
    expect(out).toBe('<a href=\'../reach/index.html?x=1\'>Contact</a>');
  });

  it('删除页面场景：指向被删页的链接改回主页', () => {
    const html = '<a href="../old/index.html">Old</a><a href="index.html">Home</a>';
    const out = rewritePageHrefs(html, 'about/index.html', 'old/index.html', 'index.html');
    expect(out).toContain('href="../index.html"');
    // 原本指向主页的链接不受影响
    expect(out).toContain('<a href="index.html">Home</a>');
  });

  it('外部协议 / mailto / tel / data 链接不动', () => {
    const html = [
      '<a href="https://example.com/x/index.html">ext</a>',
      '<a href="http://a.b">ext2</a>',
      '<a href="mailto:a@b.com">mail</a>',
      '<a href="tel:123">tel</a>',
      '<a href="data:text/html,hi">data</a>',
      '<a href="//cdn.example.com/lib/index.html">protocol-relative</a>'
    ].join('\n');
    const out = rewritePageHrefs(html, 'index.html', 'x/index.html', 'y/index.html');
    expect(out).toBe(html);
  });

  it('未命中时返回完全相同的字符串（引用稳定）', () => {
    const html = '<p>没有链接</p><a href="other/index.html">x</a>';
    expect(rewritePageHrefs(html, 'index.html', 'about/index.html', 'new/index.html')).toBe(
      html
    );
  });

  it('大小写不敏感的属性写法与空白均可匹配，且沿用原引号风格', () => {
    const html = "<a HREF = 'about/index.html'>x</a>";
    const out = rewritePageHrefs(html, 'index.html', 'about/index.html', 'info/index.html');
    expect(out).toBe("<a HREF = 'info/index.html'>x</a>");
  });

  it('目录式 href（about/）随页面重命名改写为显式入口路径', () => {
    const html = '<a href="about/">About</a>';
    const out = rewritePageHrefs(html, 'index.html', 'about/index.html', 'info/index.html');
    expect(out).toBe('<a href="info/index.html">About</a>');
  });

  it('knownPages 存在时省扩展名 href（about）也可命中并改写', () => {
    const pages = ['index.html', 'about/index.html'];
    const html = '<a href="about">About</a>';
    const out = rewritePageHrefs(
      html,
      'index.html',
      'about/index.html',
      'info/index.html',
      pages
    );
    expect(out).toBe('<a href="info/index.html">About</a>');
  });

  it('重命名已落盘（旧路径不在页面集合）时，把旧路径作为虚拟页补入仍能改写显式链接', () => {
    // 移动后磁盘上只有 info/index.html；扫描集合 + 旧路径 extraKnown
    const pages = ['index.html', 'info/index.html', 'about/index.html'];
    const html = '<a href="about/index.html">About</a><a href="about/">Dir</a>';
    const out = rewritePageHrefs(
      html,
      'index.html',
      'about/index.html',
      'info/index.html',
      pages
    );
    expect(out).toBe(
      '<a href="info/index.html">About</a><a href="info/index.html">Dir</a>'
    );
  });
});
