// test/css-variables.test.ts
import { describe, it, expect } from 'vitest';
import { parseCss, type CssBlock } from '@shared/css-utils';
import {
  collectThemeVariables,
  groupThemeVariables,
  isCustomProperty,
  isColorValue,
  isDarkScope,
  isLengthValue,
  patchThemeVariable,
  variableKind,
  variableLabel,
  type ThemeFileInput
} from '@shared/css-variables';

function fileInput(current: string, baseline?: string): ThemeFileInput {
  return {
    blocks: parseCss(current),
    baselineBlocks: parseCss(baseline ?? current)
  };
}

const ROOT = `:root {
  --ink: #1f2328;
  --muted: #6b7280;
  --accent: #c2410c;
  --line: #e7e5e0;
  --bg: #fbfaf7;
  --card: #ffffff;
  --radius: 8px;
  --font-family: Georgia, serif;
}
.container {
  color: var(--ink);
  padding: 16px;
}`;

describe('isCustomProperty', () => {
  it('识别 -- 前缀自定义属性', () => {
    expect(isCustomProperty('--ink')).toBe(true);
    expect(isCustomProperty('  --my-var2 ')).toBe(true);
    expect(isCustomProperty('color')).toBe(false);
    expect(isCustomProperty('--')).toBe(false);
    expect(isCustomProperty('--a b')).toBe(false);
  });
});

describe('值类型识别', () => {
  it('颜色字面量', () => {
    expect(isColorValue('#fff')).toBe(true);
    expect(isColorValue('#1f2328')).toBe(true);
    expect(isColorValue('rgba(0,0,0,.5)')).toBe(true);
    expect(isColorValue('hsl(120 60% 50%)')).toBe(true);
    expect(isColorValue('oklch(0.7 0.1 200)')).toBe(true);
  });
  it('非颜色：var()/渐变/尺寸', () => {
    expect(isColorValue('var(--ink)')).toBe(false);
    expect(isColorValue('linear-gradient(#000,#fff)')).toBe(false);
    expect(isColorValue('8px')).toBe(false);
    expect(isColorValue('')).toBe(false);
  });
  it('命名色', () => {
    expect(isColorValue('white')).toBe(true);
    expect(isColorValue('currentColor')).toBe(true);
  });
  it('长度值', () => {
    expect(isLengthValue('8px')).toBe(true);
    expect(isLengthValue('1.5rem')).toBe(true);
    expect(isLengthValue('0')).toBe(true);
    expect(isLengthValue('50%')).toBe(true);
    expect(isLengthValue('8 px')).toBe(false);
  });
});

describe('variableKind', () => {
  it('值优先：颜色/长度', () => {
    expect(variableKind('--x', '#abcdef')).toBe('color');
    expect(variableKind('--x', '12px')).toBe('length');
  });
  it('名字语义：颜色类名字即使值为 var() 也判为颜色', () => {
    expect(variableKind('--brand-color', 'var(--accent)')).toBe('color');
    expect(variableKind('--card', 'rgb(255 255 255)')).toBe('color');
    expect(variableKind('--surface-bg', 'red')).toBe('color');
  });
  it('font-family 优先于颜色/长度判定', () => {
    expect(variableKind('--font-family', 'Arial, sans-serif')).toBe('font');
  });
  it('字号判为尺寸', () => {
    expect(variableKind('--font-size', '16px')).toBe('length');
    expect(variableKind('--radius', '8px')).toBe('length');
  });
  it('无法识别 → other', () => {
    expect(variableKind('--ease', 'cubic-bezier(.4,0,.2,1)')).toBe('other');
  });
});

describe('collectThemeVariables', () => {
  it('收集 :root 变量并跳过普通属性与 var() 消费点', () => {
    const vars = collectThemeVariables({ 'style.css': fileInput(ROOT) });
    expect(vars.map((v) => v.name)).toEqual([
      '--ink', '--muted', '--accent', '--line', '--bg', '--card',
      '--radius', '--font-family'
    ]);
    expect(vars.every((v) => v.file === 'style.css')).toBe(true);
    expect(vars[0]).toMatchObject({ selector: ':root', blockIndex: 0, declIndex: 0 });
    expect(vars[0].inBaseline).toBe(true);
  });

  it('记录基线值并标记新增变量', () => {
    const current = `:root {
  --ink: red;
  --new-var: 12px;
}`;
    const baseline = `:root {
  --ink: blue;
}`;
    const vars = collectThemeVariables({ 'a.css': fileInput(current, baseline) });
    expect(vars[0]).toMatchObject({ name: '--ink', value: 'red', baselineValue: 'blue', inBaseline: true });
    expect(vars[1]).toMatchObject({ name: '--new-var', value: '12px', baselineValue: '', inBaseline: false });
  });

  it('同名变量在多个选择器（:root 与 .dark）各自成条', () => {
    const css = `:root { --bg: #fff; }
.dark { --bg: #111; }`;
    const vars = collectThemeVariables({ 'a.css': fileInput(css) });
    expect(vars).toHaveLength(2);
    expect(vars.map((v) => v.selector)).toEqual([':root', '.dark']);
    expect(vars.map((v) => v.value)).toEqual(['#fff', '#111']);
  });

  it('同选择器重复声明：基线查找取最后一条（CSS 后者胜）', () => {
    const current = `:root { --a: 1; --a: 2; }`;
    const baseline = `:root { --a: 0; --a: 9; }`;
    const vars = collectThemeVariables({ 'a.css': fileInput(current, baseline) });
    expect(vars).toHaveLength(2);
    expect(vars[0].value).toBe('1');
    expect(vars[1].value).toBe('2');
    expect(vars.every((v) => v.baselineValue === '9')).toBe(true);
  });

  it('多文件按输入顺序、注释与 at 规则不打断下标', () => {
    const css = `/* hello */
:root { --x: 1; }
@media (max-width: 600px) { .a { color: red; } }
:root { --y: 2; }`;
    const vars = collectThemeVariables({ 'a.css': fileInput(css) });
    // 注释=block0，:root=block1，atrule=block2，:root=block3
    expect(vars.map((v) => [v.blockIndex, v.name])).toEqual([
      [1, '--x'],
      [3, '--y']
    ]);
  });
});

describe('groupThemeVariables', () => {
  it('按 颜色→尺寸→字体→其它 顺序分组且保持组内顺序', () => {
    const vars = collectThemeVariables({ 'style.css': fileInput(ROOT) });
    const groups = groupThemeVariables(vars);
    expect(groups.map((g) => g.key)).toEqual(['color', 'length', 'font']);
    expect(groups[0].vars.map((v) => v.name)).toEqual([
      '--ink', '--muted', '--accent', '--line', '--bg', '--card'
    ]);
    expect(groups[1].vars[0].name).toBe('--radius');
    expect(groups[2].vars[0].name).toBe('--font-family');
  });

  it('空输入返回空数组', () => {
    expect(groupThemeVariables([])).toEqual([]);
  });
});

describe('patchThemeVariable', () => {
  it('不可变替换指定声明值', () => {
    const blocks = parseCss(ROOT);
    const next = patchThemeVariable(blocks, 0, 2, '#ff0000');
    expect(next).not.toBe(blocks);
    expect(next[0]).not.toBe(blocks[0]);
    const rule = next[0] as Extract<CssBlock, { kind: 'rule' }>;
    expect(rule.declarations[2]).toMatchObject({ property: '--accent', value: '#ff0000' });
    // 原数组不变
    const orig = blocks[0] as Extract<CssBlock, { kind: 'rule' }>;
    expect(orig.declarations[2].value).toBe('#c2410c');
  });

  it('越界 / 目标非变量声明时原样返回', () => {
    const blocks = parseCss(ROOT);
    expect(patchThemeVariable(blocks, 99, 0, 'x')).toBe(blocks);
    // block 1 是 .container，decl 0 是 color
    expect(patchThemeVariable(blocks, 1, 0, 'x')).toBe(blocks);
  });
});

describe('展示辅助', () => {
  it('variableLabel 中文映射与美化回退', () => {
    expect(variableLabel('--ink')).toBe('正文文字');
    expect(variableLabel('--brand-primary')).toBe('brand primary');
  });
  it('isDarkScope', () => {
    expect(isDarkScope('.dark')).toBe(true);
    expect(isDarkScope(':root.dark')).toBe(true);
    expect(isDarkScope('[data-theme="dark"]')).toBe(true);
    expect(isDarkScope(':root')).toBe(false);
    expect(isDarkScope('.darken-text')).toBe(false);
  });
});
