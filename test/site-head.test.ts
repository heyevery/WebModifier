import { describe, it, expect } from 'vitest';
import { applySiteHead, type SiteHeadOptions } from '../shared/site-head';

const HEAD =
  '<html><head><title>首页</title><meta name="description" content="原描述"></head><body></body></html>';

function opts(patch: Partial<SiteHeadOptions>): SiteHeadOptions {
  return { page: 'index.html', ...patch };
}

describe('applySiteHead — 标题模式', () => {
  it('keep（默认）不动标题', () => {
    expect(applySiteHead(HEAD, opts({}))).toBe(HEAD);
  });

  it('replace 统一标题；空文本不改动', () => {
    const out = applySiteHead(HEAD, opts({ titleMode: 'replace', titleText: 'Acme 官网' }));
    expect(out).toContain('<title>Acme 官网</title>');
    expect(out).not.toContain('首页');
    expect(applySiteHead(HEAD, opts({ titleMode: 'replace', titleText: '   ' }))).toBe(HEAD);
  });

  it('suffix 追加后缀并去重；空标题页只写后缀', () => {
    const out = applySiteHead(HEAD, opts({ titleMode: 'suffix', titleText: ' - Acme' }));
    expect(out).toContain('<title>首页 - Acme</title>');
    // 再次应用不重复追加
    const twice = applySiteHead(out, opts({ page: 'index.html', titleMode: 'suffix', titleText: ' - Acme' }));
    expect(twice).toContain('<title>首页 - Acme</title>');
    expect(twice.match(/<title/g)).toHaveLength(1);

    const noTitle = '<html><head></head><body></body></html>';
    const added = applySiteHead(noTitle, opts({ titleMode: 'suffix', titleText: ' - Acme' }));
    expect(added).toContain('<title>- Acme</title>');
  });
});

describe('applySiteHead — description', () => {
  it('undefined 不动；非空覆盖；空串移除；content 在前也能识别', () => {
    expect(applySiteHead(HEAD, opts({ description: undefined }))).toBe(HEAD);
    expect(applySiteHead(HEAD, opts({ description: '新描述' }))).toContain(
      '<meta name="description" content="新描述" />'
    );
    const removed = applySiteHead(HEAD, opts({ description: '' }));
    expect(removed).not.toMatch(/name=["']description/);

    const reversed =
      '<head><meta content="旧" name="description"></head>';
    expect(applySiteHead(reversed, opts({ description: '新' }))).toContain(
      '<meta name="description" content="新" />'
    );
  });

  it('原本没有 description 时插入到 </head> 前', () => {
    const html = '<html><head><title>x</title></head></html>';
    expect(applySiteHead(html, opts({ description: '插入的' }))).toContain(
      '<meta name="description" content="插入的" />\n</head>'
    );
  });
});

describe('applySiteHead — favicon', () => {
  it('undefined 不动；非空插入/更新；根相对路径按页面深度换算', () => {
    const out1 = applySiteHead(HEAD, opts({ favicon: 'assets/favicon.svg' }));
    expect(out1).toContain('<link rel="icon" href="assets/favicon.svg" />');

    // 子目录页面换算为 ../
    const out2 = applySiteHead(HEAD, opts({ page: 'about/index.html', favicon: 'assets/favicon.svg' }));
    expect(out2).toContain('href="../assets/favicon.svg"');

    // 根相对写法 /assets/... 等价换算
    const out3 = applySiteHead(HEAD, opts({ page: 'a/b/c.html', favicon: '/assets/f.png' }));
    expect(out3).toContain('href="../../assets/f.png"');

    // 更新已有 link
    const withIcon = '<head><link rel="shortcut icon" href="old.ico"></head>';
    expect(applySiteHead(withIcon, opts({ favicon: 'assets/new.svg' }))).toContain(
      'href="assets/new.svg"'
    );

    // 空串移除
    expect(applySiteHead(withIcon, opts({ favicon: '' }))).not.toMatch(/rel=["'].*icon/);

    // 外链/data URI 原样
    expect(applySiteHead(HEAD, opts({ page: 'about/index.html', favicon: 'https://x.com/f.png' }))).toContain(
      'href="https://x.com/f.png"'
    );
  });
});

describe('applySiteHead — Open Graph', () => {
  it('未启用时不写入 og 标签', () => {
    expect(applySiteHead(HEAD, opts({}))).not.toContain('og:');
  });

  it('启用但 title/desc 留空时跟随各页最终标题与描述', () => {
    const out = applySiteHead(
      HEAD,
      opts({ titleMode: 'suffix', titleText: ' - Acme', ogEnabled: true })
    );
    expect(out).toContain('<meta property="og:title" content="首页 - Acme" />');
    expect(out).toContain('<meta property="og:description" content="原描述" />');
  });

  it('显式值覆盖；og:image 按页面深度换算', () => {
    const out = applySiteHead(
      HEAD,
      opts({
        page: 'about/index.html',
        ogEnabled: true,
        ogTitle: '分享标题',
        ogDescription: '分享描述',
        ogImage: 'assets/cover.jpg'
      })
    );
    expect(out).toContain('<meta property="og:title" content="分享标题" />');
    expect(out).toContain('<meta property="og:description" content="分享描述" />');
    expect(out).toContain('<meta property="og:image" content="../assets/cover.jpg" />');
  });

  it('已有 og 标签（content 在前）时更新而非重复插入', () => {
    const html =
      '<head><meta content="旧分享标题" property="og:title"><meta property="og:image" content="old.png"></head>';
    const out = applySiteHead(
      html,
      opts({ ogEnabled: true, ogTitle: '新标题', ogImage: 'assets/new.png' })
    );
    expect(out.match(/og:title/g)).toHaveLength(1);
    expect(out.match(/og:image/g)).toHaveLength(1);
    expect(out).toContain('property="og:title" content="新标题"');
    expect(out).toContain('property="og:image" content="assets/new.png"');
  });
});

describe('applySiteHead — 组合应用', () => {
  it('一次调用同时处理标题/favicon/描述/OG，无 head 时也不丢失内容', () => {
    const html = '<html><body>hello</body></html>';
    const out = applySiteHead(
      html,
      opts({
        titleMode: 'replace',
        titleText: 'Acme',
        favicon: 'favicon.ico',
        description: '描述',
        ogEnabled: true,
        ogImage: 'assets/og.png'
      })
    );
    // 无 head/title 时 favicon/desc/og 插不进去（无 </head>），但不应丢正文
    expect(out).toContain('hello');
    expect(out).toContain('<title>Acme</title>');
  });
});
