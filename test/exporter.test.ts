import { describe, it, expect } from 'vitest';
import { exportTemplate, injectSiteCode } from '../electron/main/services/exporter';
import { parseTemplate } from '../electron/main/services/marker-parser';
import type { Region } from '../shared/types/region';

/** 用解析结果构造一份「已编辑」regions（深拷贝，避免污染原对象） */
function editedRegions(
  html: string,
  patch: Record<string, string>
): Region[] {
  const { regions } = parseTemplate(html, null, 'index.html');
  return regions.map((r) =>
    Object.prototype.hasOwnProperty.call(patch, r.id) ? { ...r, value: patch[r.id] } : { ...r }
  );
}

describe('exportTemplate — 文本', () => {
  it('block text：替换文字且剥离首尾注释标记', () => {
    const html = '<h1><!-- @wt:edit name="title" --><span>旧标题</span><!-- /@wt:edit --></h1>';
    const out = exportTemplate(html, editedRegions(html, { title: '新标题' }));
    expect(out).toBe('<h1><span>新标题</span></h1>');
  });

  it('attr text：替换文字并移除 data-wt-* 属性', () => {
    const html = '<p class="lead" data-wt-edit="slogan" data-wt-label="标语">旧标语</p>';
    const out = exportTemplate(html, editedRegions(html, { slogan: '新标语' }));
    expect(out).toBe('<p class="lead">新标语</p>');
  });

  it('HTML 特殊字符被转义', () => {
    const html = '<p data-wt-edit="x">a</p>';
    const out = exportTemplate(html, editedRegions(html, { x: '<b>&"q"' }));
    expect(out).toContain('&lt;b&gt;&amp;&quot;q&quot;');
  });
});

describe('exportTemplate — 链接', () => {
  it('attr link：同时替换 href 与文字', () => {
    const html = '<a class="btn" data-wt-edit="go" data-wt-type="link" href="old.html">旧文字</a>';
    const out = exportTemplate(
      html,
      editedRegions(html, { go: JSON.stringify({ href: 'new.html', text: '新文字' }) })
    );
    expect(out).toBe('<a class="btn" href="new.html">新文字</a>');
  });

  it('attr link：含嵌套元素时 href 仍准确替换且结构不损坏', () => {
    const html =
      '<a data-wt-edit="go" data-wt-type="link" href="old.html"><i>›</i> 旧文字</a>';
    const out = exportTemplate(
      html,
      editedRegions(html, { go: JSON.stringify({ href: 'new.html', text: '旧文字' }) })
    );
    expect(out).toContain('href="new.html"');
    expect(out).toContain('<i>');
    expect(out.indexOf('</a>')).toBe(out.length - 4);
  });

  it('block link：替换首元素 href 与文字，注释全剥离', () => {
    const html =
      '<!-- @wt:edit name="nav" type="link" --><a href="a.html">A</a><!-- /@wt:edit -->';
    const out = exportTemplate(
      html,
      editedRegions(html, { nav: JSON.stringify({ href: 'b.html', text: 'B' }) })
    );
    expect(out).toBe('<a href="b.html">B</a>');
  });
});

describe('exportTemplate — 图片', () => {
  it('JSON 值写入 src 与 alt；空 alt 移除属性', () => {
    const html = '<img data-wt-edit="logo" data-wt-type="image" src="old.png" alt="旧">';
    const withAlt = exportTemplate(
      html,
      editedRegions(html, { logo: JSON.stringify({ src: 'new.png', alt: '新图' }) })
    );
    expect(withAlt).toContain('src="new.png"');
    expect(withAlt).toContain('alt="新图"');
    expect(withAlt).not.toContain('data-wt');

    const withoutAlt = exportTemplate(
      html,
      editedRegions(html, { logo: JSON.stringify({ src: 'new.png', alt: '' }) })
    );
    expect(withoutAlt).toContain('src="new.png"');
    expect(withoutAlt).not.toContain('alt=');
  });

  it('旧格式纯字符串值只改 src，原 alt 保留', () => {
    const html = '<img data-wt-edit="logo" data-wt-type="image" src="old.png" alt="保留">';
    const out = exportTemplate(html, editedRegions(html, { logo: 'x.png' }));
    expect(out).toContain('src="x.png"');
    expect(out).toContain('alt="保留"');
  });
});

describe('exportTemplate — 颜色与样式', () => {
  it('color：写入 style 中目标 CSS 属性', () => {
    const html =
      '<span data-wt-edit="c" data-wt-type="color" data-wt-prop="color" style="color: red;">x</span>';
    const out = exportTemplate(html, editedRegions(html, { c: '#00ff00' }));
    expect(out).toContain('style="color: #00ff00;"');
  });

  it('custom-css：整体重建 style；空值移除 style', () => {
    const html = '<div data-wt-edit="box" data-wt-type="custom-css" style="color: red;">x</div>';
    const filled = exportTemplate(
      html,
      editedRegions(html, { box: JSON.stringify({ color: 'blue', 'font-size': '20px' }) })
    );
    expect(filled).toContain('style="color: blue; font-size: 20px"');

    const emptied = exportTemplate(html, editedRegions(html, { box: JSON.stringify({}) }));
    expect(emptied).not.toContain('style=');
  });
});

describe('exportTemplate — 结构类型', () => {
  it('list：按 JSON 数组重建 li', () => {
    const html =
      '<ul data-wt-edit="tags" data-wt-type="list"><li>甲</li><li>乙</li></ul>';
    const out = exportTemplate(
      html,
      editedRegions(html, { tags: JSON.stringify(['一', '二', '三']) })
    );
    expect(out).toBe(
      '<ul>  <li>一</li>\n  <li>二</li>\n  <li>三</li></ul>'
    );
  });

  it('list：原始 li 跨行带缩进时仍按嵌套深度正确整体重建（回归：闭合标签误匹配）', () => {
    const html = '<ul data-wt-edit="tags" data-wt-type="list">\n  <li>甲</li>\n  <li>乙</li>\n</ul>';
    const out = exportTemplate(
      html,
      editedRegions(html, { tags: JSON.stringify(['一', '二']) })
    );
    expect(out).toBe('<ul>  <li>一</li>\n  <li>二</li></ul>');
  });

  it('video：src/poster/controls 同步', () => {
    const html =
      '<video data-wt-edit="v" data-wt-type="video" src="a.mp4" controls></video>';
    const off = exportTemplate(
      html,
      editedRegions(html, { v: JSON.stringify({ src: 'b.mp4', poster: 'p.jpg', controls: false }) })
    );
    expect(off).toContain('src="b.mp4"');
    expect(off).toContain('poster="p.jpg"');
    expect(off).not.toContain(' controls');
  });
});

describe('exportTemplate — 标记清理', () => {
  it('未编辑区域的标记属性也会在导出时剥离', () => {
    const html =
      '<p data-wt-edit="a">A</p><!-- @wt:edit name="b" --><span>B</span><!-- /@wt:edit -->';
    const out = exportTemplate(html, editedRegions(html, {}));
    expect(out).not.toContain('data-wt-edit');
    expect(out).not.toContain('@wt:edit');
    expect(out).toContain('>A</p>');
    expect(out).toContain('<span>B</span>');
  });
});

describe('exportTemplate — 全站公共区 @wt:shared', () => {
  it('块级 shared text：替换值并剥离 shared 注释', () => {
    const html =
      '<!-- @wt:shared name="nav-brand" type="text" --><a class="brand">旧品牌</a><!-- /@wt:shared -->';
    const out = exportTemplate(html, editedRegions(html, { 'nav-brand': '新品牌' }));
    expect(out).toContain('>新品牌</a>');
    expect(out).not.toContain('@wt:shared');
  });

  it('属性 shared link：href 与文字同时替换并剥离 data-wt-shared', () => {
    const html = '<a data-wt-shared="go" data-wt-type="link" href="old.html">旧文字</a>';
    const out = exportTemplate(
      html,
      editedRegions(html, { go: JSON.stringify({ href: 'new.html', text: '新文字' }) })
    );
    expect(out).toContain('href="new.html"');
    expect(out).toContain('>新文字</a>');
    expect(out).not.toContain('data-wt-shared');
  });

  it('未编辑的 shared 标记导出时也被剥离', () => {
    const html =
      '<img data-wt-shared="logo" data-wt-type="image" src="a.png" alt="L">' +
      '<!-- @wt:shared name="copy" --><span>© 2026</span><!-- /@wt:shared -->';
    const out = exportTemplate(html, editedRegions(html, {}));
    expect(out).not.toContain('data-wt-shared');
    expect(out).not.toContain('@wt:shared');
    expect(out).toContain('src="a.png"');
    expect(out).toContain('<span>© 2026</span>');
  });
});

describe('injectSiteCode — 全站自定义代码', () => {
  const page = '<html><head><title>x</title></head><body><p>hi</p></body></html>';

  it('head 代码插到 </head> 前，body 代码插到 </body> 前，且原样不转义', () => {
    const head = '<meta name="x" content="a&b"><script>var h=1;</script>';
    const body = '<div id="kf">客服</div><script src="https://example.com/kf.js"></script>';
    const out = injectSiteCode(page, { head, body });
    expect(out).toBe(
      '<html><head><title>x</title>' + head + '\n</head><body><p>hi</p>' + body + '\n</body></html>'
    );
    // 引号、& 与标签均原样保留
    expect(out).toContain('a&b');
    expect(out).toContain('<script src="https://example.com/kf.js"></script>');
  });

  it('undefined / 空对象 / 纯空白均原样返回', () => {
    expect(injectSiteCode(page)).toBe(page);
    expect(injectSiteCode(page, {})).toBe(page);
    expect(injectSiteCode(page, { head: '   \n', body: '\t' })).toBe(page);
  });

  it('只填 head 时不影响 body；首尾空白被 trim', () => {
    const out = injectSiteCode(page, { head: '  <link rel="x" href="x.css">  ' });
    expect(out).toBe('<html><head><title>x</title><link rel="x" href="x.css">\n</head><body><p>hi</p></body></html>');
  });

  it('无 </head> 但有 <body>：head 代码插到 <body> 前；无 </body>：body 代码追加到末尾', () => {
    const noHead = '<html><body><p>hi</p></body></html>';
    const out = injectSiteCode(noHead, { head: '<meta name="v">' });
    expect(out).toBe('<html><meta name="v">\n<body><p>hi</p></body></html>');

    const noBodyEnd = '<html><head></head><body><p>hi</p></html>';
    const out2 = injectSiteCode(noBodyEnd, { body: '<b>x</b>' });
    expect(out2.startsWith('<html><head></head><body><p>hi</p>')).toBe(true);
    expect(out2.endsWith('<b>x</b>\n')).toBe(true);
  });

  it('连 <body> 都没有：head 代码前置到文档开头', () => {
    const bare = '<p>hi</p>';
    const out = injectSiteCode(bare, { head: '<meta name="v">' });
    expect(out).toBe('<meta name="v">\n<p>hi</p>');
  });

  it('大小写闭合标签（</HEAD>）也能命中', () => {
    const upper = '<html><HEAD></HEAD><BODY></BODY></html>';
    const out = injectSiteCode(upper, { head: '<meta>', body: '<div></div>' });
    expect(out).toContain('<meta>\n</HEAD>');
    expect(out).toContain('<div></div>\n</BODY>');
  });
});
