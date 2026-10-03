// test/external-images.test.ts
import { describe, it, expect } from 'vitest';
import {
  EXTERNAL_IMAGES_DIR,
  assetFileBase,
  assetSitePath,
  collectExternalImages,
  extFromContentType,
  extractCssImageUrls,
  extractHtmlImageUrls,
  imageExtFromUrl,
  isExternalUrl,
  looksLikeImageUrl,
  normalizeExternalUrl,
  parseSrcset,
  relativeAssetRef,
  resolveImageExt,
  rewriteExternalRefs,
  urlVariants
} from '@shared/external-images';

describe('isExternalUrl', () => {
  it('识别 http/https/协议相对，排除 data/blob/相对路径', () => {
    expect(isExternalUrl('https://a.com/x.jpg')).toBe(true);
    expect(isExternalUrl('http://a.com/x')).toBe(true);
    expect(isExternalUrl('//a.com/x.png')).toBe(true);
    expect(isExternalUrl('  https://a.com/x.jpg ')).toBe(true);
    expect(isExternalUrl('assets/x.jpg')).toBe(false);
    expect(isExternalUrl('/assets/x.jpg')).toBe(false);
    expect(isExternalUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isExternalUrl('blob:https://x/1')).toBe(false);
    expect(isExternalUrl('mailto:a@b.com')).toBe(false);
  });
});

describe('looksLikeImageUrl', () => {
  it('图片扩展名通过', () => {
    expect(looksLikeImageUrl('https://a.com/x.PNG')).toBe(true);
    expect(looksLikeImageUrl('https://a.com/x.jpeg?v=1')).toBe(true);
    expect(looksLikeImageUrl('https://a.com/a.b.c.svg#frag')).toBe(true);
  });
  it('字体/媒体/脚本扩展名排除', () => {
    expect(looksLikeImageUrl('https://a.com/f.woff2')).toBe(false);
    expect(looksLikeImageUrl('https://a.com/f.woff')).toBe(false);
    expect(looksLikeImageUrl('https://a.com/v.mp4')).toBe(false);
    expect(looksLikeImageUrl('https://a.com/a.ttf')).toBe(false);
    expect(looksLikeImageUrl('https://a.com/app.js')).toBe(false);
  });
  it('无扩展名视为图片候选（picsum 类图床）', () => {
    expect(looksLikeImageUrl('https://picsum.photos/seed/x/1200/560')).toBe(true);
  });
});

describe('normalizeExternalUrl', () => {
  it('协议相对补 https、去 hash、去空白', () => {
    expect(normalizeExternalUrl('//a.com/x.png')).toBe('https://a.com/x.png');
    expect(normalizeExternalUrl('  https://a.com/x.jpg#section ')).toBe('https://a.com/x.jpg');
  });
  it('保留 query，拒绝非 http(s)', () => {
    expect(normalizeExternalUrl('https://a.com/x?w=1200&q=80')).toBe('https://a.com/x?w=1200&q=80');
    expect(normalizeExternalUrl('data:image/png;base64,x')).toBeNull();
    expect(normalizeExternalUrl('assets/x.png')).toBeNull();
    expect(normalizeExternalUrl('')).toBeNull();
  });
});

describe('urlVariants', () => {
  it('给出 https/http/协议相对三种形态', () => {
    expect(urlVariants('https://a.com/x.jpg').sort()).toEqual(
      ['//a.com/x.jpg', 'http://a.com/x.jpg', 'https://a.com/x.jpg'].sort()
    );
    expect(urlVariants('http://a.com/x.jpg')).toContain('//a.com/x.jpg');
  });
});

describe('extractHtmlImageUrls', () => {
  it('收集 img src（双/单引号）与无扩展名图床 URL', () => {
    const html = `
      <img src="https://picsum.photos/seed/blog-cover/1200/560" />
      <img src='https://cdn.test/a.png' alt="x">`;
    expect(extractHtmlImageUrls(html)).toEqual([
      'https://picsum.photos/seed/blog-cover/1200/560',
      'https://cdn.test/a.png'
    ]);
  });

  it('收集 srcset 多候选', () => {
    const html = `<img src="/local.jpg" srcset="https://a.com/1x.jpg 1x, https://a.com/2x.jpg 2x">`;
    expect(extractHtmlImageUrls(html)).toEqual([
      'https://a.com/1x.jpg',
      'https://a.com/2x.jpg'
    ]);
  });

  it('收集 video poster，source 在 picture 场景收 src、视频文件被扩展名排除', () => {
    const html = `
      <video poster="https://a.com/poster.webp" controls>
        <source src="https://a.com/trailer.mp4" type="video/mp4">
      </video>
      <picture><source srcset="https://a.com/m.avif" type="image/avif" /></picture>`;
    const urls = extractHtmlImageUrls(html);
    expect(urls).toContain('https://a.com/poster.webp');
    expect(urls).toContain('https://a.com/m.avif');
    expect(urls).not.toContain('https://a.com/trailer.mp4');
  });

  it('收集 <style> 块与 style 属性内的外链 url()，忽略相对与字体', () => {
    const html = `
      <style>.x{background:url(https://a.com/bg.png)}</style>
      <div style="background-image:url('//a.com/cover.jpg')"></div>
      <span style="background:url(assets/local.png)"></span>
      <style>@font-face{src:url(https://a.com/f.woff2)}</style>`;
    const urls = extractHtmlImageUrls(html);
    expect(urls).toContain('https://a.com/bg.png');
    expect(urls).toContain('//a.com/cover.jpg');
    expect(urls.some((u) => u.includes('local.png'))).toBe(false);
    expect(urls.some((u) => u.includes('f.woff2'))).toBe(false);
  });
});

describe('extractCssImageUrls', () => {
  it('支持引号/无引号/空白/协议相对，排除字体与非图片', () => {
    const css = `
      .a { background: url("https://a.com/x.png"); }
      .b { background: url( '//a.com/y.webp' ); }
      .c { background: url(https://a.com/z); }
      @font-face { src: url(https://a.com/f.woff2) format('woff2'); }`;
    expect(extractCssImageUrls(css)).toEqual([
      'https://a.com/x.png',
      '//a.com/y.webp',
      'https://a.com/z'
    ]);
  });
});

describe('parseSrcset', () => {
  it('逗号分隔取每段 URL', () => {
    expect(parseSrcset('https://a.com/1.jpg 320w, https://a.com/2.jpg 640w')).toEqual([
      'https://a.com/1.jpg',
      'https://a.com/2.jpg'
    ]);
    expect(parseSrcset('https://a.com/x.webp 2x')).toEqual(['https://a.com/x.webp']);
  });
});

describe('collectExternalImages', () => {
  it('跨文件去重聚合并统计次数与位置（保持首次发现顺序）', () => {
    const res = collectExternalImages({
      html: {
        'index.html': `<img src="https://a.com/x.png"><img src="https://a.com/x.png">
          <source srcset="//a.com/y.webp 2x">`,
        'sub/about.html': `<img src="https://a.com/x.png">`
      },
      css: {
        'style.css': `.x{background:url(https://a.com/x.png)}`,
        'sub/other.css': `.y{background:url(https://b.com/z.jpg)}`
      }
    });
    expect(res.map((i) => i.url)).toEqual(['https://a.com/x.png', 'https://a.com/y.webp', 'https://b.com/z.jpg']);
    const first = res[0];
    expect(first.occurrences).toBe(4); // 2 index + 1 about + 1 css
    expect(first.locations).toHaveLength(3);
    expect(first.locations).toContainEqual({ source: 'index.html', kind: 'html' });
    expect(first.locations).toContainEqual({ source: 'sub/about.html', kind: 'html' });
    expect(first.locations).toContainEqual({ source: 'style.css', kind: 'css' });
  });

  it('无文件/无外链返回空数组', () => {
    expect(collectExternalImages({})).toEqual([]);
    expect(collectExternalImages({ html: { 'index.html': '<img src="assets/a.png">' } })).toEqual([]);
  });
});

describe('命名与扩展名', () => {
  it('文件名主干对同一 URL 稳定且不同 URL 不同', () => {
    expect(assetFileBase('https://a.com/x.jpg')).toBe(assetFileBase('https://a.com/x.jpg'));
    expect(assetFileBase('https://a.com/x.jpg')).not.toBe(assetFileBase('https://a.com/y.jpg'));
    expect(assetFileBase('https://a.com/x.jpg')).toMatch(/^img-[0-9a-z]+$/);
  });

  it('Content-Type 映射', () => {
    expect(extFromContentType('image/jpeg')).toBe('jpg');
    expect(extFromContentType('image/svg+xml; charset=utf-8')).toBe('svg');
    expect(extFromContentType('image/x-icon')).toBe('ico');
    expect(extFromContentType('text/html')).toBeNull();
  });

  it('URL 扩展名白名单', () => {
    expect(imageExtFromUrl('https://a.com/x.JPEG')).toBe('jpg');
    expect(imageExtFromUrl('https://a.com/x.png?v=1')).toBe('png');
    expect(imageExtFromUrl('https://a.com/x.exe')).toBeNull();
    expect(imageExtFromUrl('https://a.com/no-ext')).toBeNull();
  });

  it('resolveImageExt：Content-Type 优先，退回 URL', () => {
    expect(resolveImageExt('https://picsum.photos/seed/x/1200/560', 'image/jpeg')).toBe('jpg');
    expect(resolveImageExt('https://a.com/x.png', 'image/png')).toBe('png');
    expect(resolveImageExt('https://a.com/x.gif')).toBe('gif');
    expect(resolveImageExt('https://a.com/x', 'text/html')).toBe('');
  });

  it('站点路径与页面相对引用', () => {
    expect(assetSitePath('img-ab.jpg')).toBe(`${EXTERNAL_IMAGES_DIR}/img-ab.jpg`);
    expect(relativeAssetRef('index.html', `${EXTERNAL_IMAGES_DIR}/img-ab.jpg`)).toBe(
      'assets/external/img-ab.jpg'
    );
    expect(relativeAssetRef('sub/about.html', `${EXTERNAL_IMAGES_DIR}/img-ab.jpg`)).toBe(
      '../assets/external/img-ab.jpg'
    );
    expect(relativeAssetRef('sub/css/style.css', `${EXTERNAL_IMAGES_DIR}/img-ab.jpg`)).toBe(
      '../../assets/external/img-ab.jpg'
    );
  });
});

describe('rewriteExternalRefs', () => {
  it('字面量替换三种形态，不动其它文本', () => {
    const text = `<img src="https://a.com/x.jpg">
      <img src="//a.com/x.jpg">
      <a href="https://a.com/page">link</a>`;
    const out = rewriteExternalRefs(text, [{ url: 'https://a.com/x.jpg', localRef: 'assets/external/img-x.jpg' }]);
    expect(out).toContain('src="assets/external/img-x.jpg"');
    expect(out).toContain('href="https://a.com/page"');
    expect(out).not.toContain('a.com/x.jpg');
  });

  it('CSS url() 与含 query 的 URL 原样替换', () => {
    const css = `.a{background:url(https://a.com/bg.png)} .b{background:url(https://a.com/x?w=1200)}`;
    const out = rewriteExternalRefs(css, [
      { url: 'https://a.com/bg.png', localRef: '../assets/external/img-bg.png' },
      { url: 'https://a.com/x?w=1200', localRef: '../assets/external/img-x.jpg' }
    ]);
    expect(out).toBe(
      `.a{background:url(../assets/external/img-bg.png)} .b{background:url(../assets/external/img-x.jpg)}`
    );
  });

  it('无命中返回原串（引用相等）', () => {
    const text = '<img src="https://other.com/x.jpg">';
    expect(rewriteExternalRefs(text, [{ url: 'https://a.com/x.jpg', localRef: 'a.jpg' }])).toBe(text);
  });
});
