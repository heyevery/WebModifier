// test/css-isolation.test.ts
// CSS 项目隔离的纯函数：覆盖拼接顺序与页面改名时的键迁移
import { describe, it, expect } from 'vitest';
import { overrideCssText, remapCssKeys } from '@shared/css-isolation';

describe('overrideCssText', () => {
  it('按 cssFiles 顺序拼接，且只包含存在覆盖的文件', () => {
    const cssFiles = ['a.css', 'b.css', 'sub/c.css', 'z.css'];
    const overrides = {
      'sub/c.css': '.c { color: green; }',
      'a.css': '.a { color: red; }'
    };
    expect(overrideCssText(cssFiles, overrides)).toBe(
      '.a { color: red; }\n.c { color: green; }'
    );
  });

  it('无覆盖时返回空串（不注入空 style）', () => {
    expect(overrideCssText(['a.css'], {})).toBe('');
    expect(overrideCssText([], {})).toBe('');
  });
});

describe('remapCssKeys', () => {
  it('页面目录改名：旧前缀下的键整体迁移，其他键不动', () => {
    const m = {
      'about/style.css': 'A',
      'about/sub/x.css': 'B',
      'assets/base.css': 'C',
      'style.css': 'D'
    };
    expect(remapCssKeys(m, 'about/', 'about-new/')).toEqual({
      'about-new/style.css': 'A',
      'about-new/sub/x.css': 'B',
      'assets/base.css': 'C',
      'style.css': 'D'
    });
  });

  it('空前缀（根页面）或前后缀相同时光标返回原对象', () => {
    const m = { 'a.css': 'A' };
    expect(remapCssKeys(m, '', 'x/')).toBe(m);
    expect(remapCssKeys(m, 'a/', 'a/')).toBe(m);
  });
});
