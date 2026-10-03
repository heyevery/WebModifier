import { describe, it, expect } from 'vitest';
import { parseCss, parseDeclarations, serializeCss } from '../shared/css-utils';

describe('parseDeclarations', () => {
  it('解析基本键值对并去空白', () => {
    const decls = parseDeclarations('color: red; margin : 0 auto ;');
    expect(decls).toEqual([
      { property: 'color', value: 'red' },
      { property: 'margin', value: '0 auto' }
    ]);
  });

  it('值中含括号时分号不应切分（grid-template / url）', () => {
    const decls = parseDeclarations(
      'grid-template-areas: "head head" "main side"; background: url(a;b).png;'
    );
    expect(decls).toHaveLength(2);
    expect(decls[0].property).toBe('grid-template-areas');
    expect(decls[0].value).toBe('"head head" "main side"');
    expect(decls[1].value).toBe('url(a;b).png');
  });

  it('忽略声明体内注释与无法识别片段', () => {
    const decls = parseDeclarations('/* todo: x */ color: blue; not-a-declaration;');
    expect(decls).toEqual([{ property: 'color', value: 'blue' }]);
  });

  it('末尾无分号的声明仍可解析', () => {
    const decls = parseDeclarations('padding: 10px');
    expect(decls).toEqual([{ property: 'padding', value: '10px' }]);
  });
});

describe('parseCss', () => {
  it('区分 comment / atrule / rule 三类顶层块', () => {
    const css = `
/* 注释块 */
@import url("base.css");
.hero {
  color: red; /* 行内注释 */
}
@media (max-width: 768px) {
  .hero { color: blue; }
}
`;
    const blocks = parseCss(css);
    expect(blocks[0].kind).toBe('comment');
    expect(blocks[1].kind).toBe('atrule');
    expect(blocks[2].kind).toBe('rule');
    expect(blocks[2]).toMatchObject({
      kind: 'rule',
      selector: '.hero',
      declarations: [{ property: 'color', value: 'red' }]
    });
    expect(blocks[3].kind).toBe('atrule');
    expect(blocks[3]).toMatchObject({ raw: expect.stringContaining('@media') });
  });

  it('逗号选择器与多选择器保留原文', () => {
    const blocks = parseCss('a, b:hover {\n  color: inherit;\n}');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'rule', selector: 'a, b:hover' });
  });
});

describe('serializeCss', () => {
  it('空输入返回空串', () => {
    expect(serializeCss([])).toBe('');
  });

  it('注释与 at 规则原样保留', () => {
    const comment = '/* keep me */';
    const atrule = '@media print { .a { color: black; } }';
    const out = serializeCss([
      { kind: 'comment', text: comment },
      { kind: 'atrule', raw: atrule }
    ]);
    expect(out).toContain(comment);
    expect(out).toContain(atrule);
  });

  it('parse → serialize → parse 往返幂等（语义等价）', () => {
    const css = `
body { margin: 0; font-family: sans-serif; }
.card { border-radius: 8px; }
`;
    const once = serializeCss(parseCss(css));
    const twice = serializeCss(parseCss(once));
    expect(once).toBe(twice);

    const blocks = parseCss(once);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: 'rule',
      selector: 'body',
      declarations: [
        { property: 'margin', value: '0' },
        { property: 'font-family', value: 'sans-serif' }
      ]
    });
    expect(blocks[1]).toMatchObject({
      kind: 'rule',
      selector: '.card',
      declarations: [{ property: 'border-radius', value: '8px' }]
    });
  });
});
