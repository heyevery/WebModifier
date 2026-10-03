import { describe, it, expect } from 'vitest';
import {
  scanPageHealth,
  missingAssetIssue,
  summarizeIssues,
  isExternalRef
} from '../shared/health-check';

const PAGES = ['index.html', 'about/index.html', 'contact.html'];

const GOOD_HEAD =
  '<head><title>首页</title><meta name="description" content="网站简介"></head>';

describe('scanPageHealth — head 元信息', () => {
  it('标题与描述齐全时无 warning', () => {
    const { issues } = scanPageHealth('index.html', `<html>${GOOD_HEAD}<body></body></html>`, PAGES);
    expect(issues.filter((i) => i.code.startsWith('empty'))).toHaveLength(0);
  });

  it('缺 title 标签 / title 为空都报 warning', () => {
    const noTitle = scanPageHealth('index.html', '<html><head><meta name="description" content="x"></head></html>', PAGES);
    expect(noTitle.issues.some((i) => i.code === 'empty-title')).toBe(true);

    const emptyTitle = scanPageHealth(
      'index.html',
      '<html><head><title>   </title><meta name="description" content="x"></head></html>',
      PAGES
    );
    expect(emptyTitle.issues.some((i) => i.code === 'empty-title')).toBe(true);
  });

  it('缺 description 或 content 为空报 warning；content 顺序反过来也能识别', () => {
    const r1 = scanPageHealth('index.html', '<head><title>x</title></head>', PAGES);
    expect(r1.issues.some((i) => i.code === 'empty-description')).toBe(true);

    const r2 = scanPageHealth(
      'index.html',
      '<head><title>x</title><meta content="" name="description"></head>',
      PAGES
    );
    expect(r2.issues.some((i) => i.code === 'empty-description')).toBe(true);

    const r3 = scanPageHealth(
      'index.html',
      '<head><title>x</title><meta content="反过来写的描述" name="description"></head>',
      PAGES
    );
    expect(r3.issues.some((i) => i.code === 'empty-description')).toBe(false);
  });
});

describe('scanPageHealth — 站内链接', () => {
  it('指向存在页面（含目录式/省扩展名）不报死链', () => {
    const html = `<html>${GOOD_HEAD}<body>
      <a href="about/index.html">a</a>
      <a href="about/">dir</a>
      <a href="contact">noext</a>
      <a href="/index.html">root</a>
    </body></html>`;
    const { issues } = scanPageHealth('index.html', html, PAGES);
    expect(issues.some((i) => i.code === 'broken-link')).toBe(false);
  });

  it('指向不存在的页面报 error 死链', () => {
    const html = `<html>${GOOD_HEAD}<body><a href="../nope.html">x</a></body></html>`;
    const { issues } = scanPageHealth('about/index.html', html, PAGES);
    const dead = issues.filter((i) => i.code === 'broken-link');
    expect(dead).toHaveLength(1);
    expect(dead[0].message).toContain('../nope.html');
  });

  it('外部链接/mailto/tel/纯锚点/协议相对一律跳过', () => {
    const html = `<html>${GOOD_HEAD}<body>
      <a href="https://x.com/a">x</a>
      <a href="http://x.com">x</a>
      <a href="//cdn.x.com/a">x</a>
      <a href="mailto:a@b.com">x</a>
      <a href="tel:123">x</a>
      <a href="#section">x</a>
      <a href="?tab=1">x</a>
    </body></html>`;
    const { issues, assets } = scanPageHealth('index.html', html, PAGES);
    expect(issues).toHaveLength(0);
    expect(assets).toHaveLength(0);
  });

  it('指向非页面文件（pdf/zip 等）进入 assets 清单而非直接判死', () => {
    const html = `<html>${GOOD_HEAD}<body><a href="./files/a.pdf">pdf</a></body></html>`;
    const { issues, assets } = scanPageHealth('index.html', html, PAGES);
    expect(issues).toHaveLength(0);
    expect(assets).toEqual([
      { page: 'index.html', kind: 'file', ref: './files/a.pdf', resolved: 'files/a.pdf' }
    ]);
  });

  it('单引号属性也能识别', () => {
    const html = `<html>${GOOD_HEAD}<body><a href='ghost.html'>x</a></body></html>`;
    const { issues } = scanPageHealth('index.html', html, PAGES);
    expect(issues.some((i) => i.code === 'broken-link')).toBe(true);
  });
});

describe('scanPageHealth — 图片与媒体', () => {
  it('相对图片进入 assets 并正确解析相对路径', () => {
    const html = `<html>${GOOD_HEAD}<body>
      <img src="../assets/img/a.png" alt="a">
      <img src='/static/b.jpg'>
      <video poster="cover.webp" src="media/v.mp4"></video>
      <audio src="audio/s.mp3"></audio>
      <picture><source srcset="x.aviv" src="img/p.webp"></picture>
    </body></html>`;
    const { assets } = scanPageHealth('about/index.html', html, PAGES);
    expect(assets).toContainEqual({
      page: 'about/index.html', kind: 'image',
      ref: '../assets/img/a.png', resolved: 'assets/img/a.png'
    });
    expect(assets).toContainEqual({
      page: 'about/index.html', kind: 'image',
      ref: '/static/b.jpg', resolved: 'static/b.jpg'
    });
    expect(assets).toContainEqual({
      page: 'about/index.html', kind: 'image',
      ref: 'cover.webp', resolved: 'about/cover.webp'
    });
    expect(assets).toContainEqual({
      page: 'about/index.html', kind: 'media',
      ref: 'media/v.mp4', resolved: 'about/media/v.mp4'
    });
    expect(assets.some((a) => a.ref === 'img/p.webp')).toBe(true);
  });

  it('外链/data URI 图片跳过', () => {
    const html = `<html>${GOOD_HEAD}<body>
      <img src="https://x.com/a.png">
      <img src="data:image/png;base64,AAAA">
    </body></html>`;
    const { assets } = scanPageHealth('index.html', html, PAGES);
    expect(assets).toHaveLength(0);
  });
});

describe('辅助函数', () => {
  it('missingAssetIssue：文件存在返回 null，缺失按类型出问题项', () => {
    const file = { page: 'index.html', kind: 'file' as const, ref: 'a.pdf', resolved: 'a.pdf' };
    const img = { page: 'index.html', kind: 'image' as const, ref: 'a.png', resolved: 'a.png' };
    const media = { page: 'index.html', kind: 'media' as const, ref: 'v.mp4', resolved: 'v.mp4' };
    expect(missingAssetIssue(file, true)).toBeNull();
    expect(missingAssetIssue(file, false)?.code).toBe('broken-link');
    expect(missingAssetIssue(img, false)?.code).toBe('missing-image');
    expect(missingAssetIssue(img, false)?.message).toContain('图片');
    expect(missingAssetIssue(media, false)?.message).toContain('媒体');
  });

  it('summarizeIssues 统计 error/warning', () => {
    const { issues, assets } = scanPageHealth(
      'index.html',
      '<head></head><body><a href="x.html"></a><img src="a.png"></body>',
      PAGES
    );
    const missing = missingAssetIssue(assets[0], false)!;
    expect(summarizeIssues([...issues, missing])).toEqual({ errors: 2, warnings: 2 });
  });

  it('isExternalRef 判定', () => {
    expect(isExternalRef('https://a')).toBe(true);
    expect(isExternalRef('mailto:a@b')).toBe(true);
    expect(isExternalRef('#x')).toBe(true);
    expect(isExternalRef('')).toBe(true);
    expect(isExternalRef('//a/b')).toBe(true);
    expect(isExternalRef('a/b.png')).toBe(false);
    expect(isExternalRef('/a/b.png')).toBe(false);
  });
});
