// shared/css-variables.ts
// CSS 主题变量（自定义属性）的纯逻辑：从结构化 CSS 块中收集 --var 声明、
// 智能分类/分组、按位置打补丁。渲染层主题面板与测试共用，无 DOM / fs 依赖。

import type { CssBlock } from './css-utils';

/** 一条主题变量（定位到具体文件 / 规则 / 声明，供编辑时精确回写） */
export interface ThemeVariable {
  /** 变量名，含前缀 -- */
  name: string;
  /** 当前值（考虑会话覆盖后的生效值） */
  value: string;
  /** 模板基线值（未改动时与 value 相同；基线无此声明时为空串） */
  baselineValue: string;
  /** 基线是否存在该声明（用户在会话中新增的变量为 false） */
  inBaseline: boolean;
  /** 所在 CSS 文件（相对模板根的 POSIX 路径） */
  file: string;
  /** 所在顶层规则在当前 blocks 中的下标 */
  blockIndex: number;
  /** 声明在规则 declarations 中的下标 */
  declIndex: number;
  /** 所在规则选择器，如 :root / html / [data-theme="dark"] */
  selector: string;
}

/** 单个文件的结构化 CSS：当前生效块 + 模板基线块 */
export interface ThemeFileInput {
  /** 当前生效块（有会话覆盖时为覆盖内容，否则为磁盘解析结果） */
  blocks: CssBlock[];
  /** 模板基线块 */
  baselineBlocks: CssBlock[];
}

export type ThemeVarKind = 'color' | 'length' | 'font' | 'other';

export interface ThemeVarGroup {
  key: ThemeVarKind;
  title: string;
  vars: ThemeVariable[];
}

/** CSS 自定义属性名：--name */
const CUSTOM_PROP_RE = /^--[A-Za-z0-9_-]+$/;

export function isCustomProperty(property: string): boolean {
  return CUSTOM_PROP_RE.test(property.trim());
}

/* ---------------- 颜色 / 尺寸识别（纯字符串，无 DOM） ---------------- */

const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR_RE = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'inherit', 'initial', 'unset',
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple',
  'pink', 'brown', 'gray', 'grey', 'cyan', 'magenta', 'lime', 'navy',
  'teal', 'indigo', 'violet', 'gold', 'silver', 'beige', 'coral', 'salmon',
  'khaki', 'crimson', 'turquoise', 'tan', 'skyblue', 'lightgray', 'darkgray',
  'darkred', 'darkgreen', 'darkblue', 'lightblue', 'lightgreen', 'lightyellow'
]);

/** 值是否为可识别的颜色字面量（var()/渐变不算） */
export function isColorValue(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('var(') || v.includes('gradient')) return false;
  if (HEX_RE.test(v) || FUNC_COLOR_RE.test(v)) return true;
  return NAMED_COLORS.has(v.toLowerCase());
}

const LENGTH_TOKEN_RE = /^-?\d+(?:\.\d+)?(?:px|em|rem|%|vw|vh|vmin|vmax|pt|pc|in|cm|mm|ch|ex)?$/;

export function isLengthValue(value: string): boolean {
  const v = value.trim();
  return !!v && LENGTH_TOKEN_RE.test(v);
}

function nameHint(name: string): string {
  return name.toLowerCase().replace(/^--/, '');
}

/**
 * 判定变量的控件类型：
 * - 名字 font-family / font-stack → 字体
 * - 颜色字面量，或名字带颜色语义（color/bg/accent/ink/brand/...）→ 颜色
 * - 长度字面量，或名字带尺寸语义（size/radius/spacing/...）→ 尺寸
 * - 其余走原始文本
 */
export function variableKind(name: string, value: string): ThemeVarKind {
  const hint = nameHint(name);
  if (/(?:^|-)(?:font-family|font-stack|font-family-stack)$/.test(hint) ||
      hint.includes('font-family') || hint.includes('font-stack')) {
    return 'font';
  }
  if (
    isColorValue(value) ||
    /(?:^|-)(?:color|colors|bg|background|ink|text|muted|accent|brand|primary|secondary|tertiary|link|line|border|fill|stroke|card|surface|panel|popover|heading|shadow|theme)(?:-|$)/.test(
      hint
    ) ||
    /(?:color|bg|accent|brand|ink|paint)/.test(hint)
  ) {
    return 'color';
  }
  if (
    isLengthValue(value) ||
    /(?:size|radius|spacing|gap|padding|margin|width|height|blur|offset)$/.test(hint) ||
    /(?:font-size|line-height)/.test(hint)
  ) {
    return 'length';
  }
  return 'other';
}

/** 在基线块中查找某选择器下变量的最后一条声明值（CSS 同层后者胜）；不存在返回 null */
function findBaselineValue(baselineBlocks: CssBlock[], selector: string, name: string): string | null {
  let found: string | null = null;
  for (const b of baselineBlocks) {
    if (b.kind !== 'rule' || b.selector !== selector) continue;
    for (const d of b.declarations) {
      if (d.property.trim() === name) found = d.value;
    }
  }
  return found;
}

/**
 * 从多个 CSS 文件收集主题变量：任何普通规则中的 --自定义属性声明都收集
 * （典型位置 :root / html / body / [data-theme] / .dark，不限定选择器）。
 * 输入按文件给出「当前块 + 基线块」，输出保持 文件 → 规则 → 声明 的文档顺序。
 */
export function collectThemeVariables(files: Record<string, ThemeFileInput>): ThemeVariable[] {
  const vars: ThemeVariable[] = [];
  for (const [file, input] of Object.entries(files)) {
    const { blocks, baselineBlocks } = input;
    blocks.forEach((block, blockIndex) => {
      if (block.kind !== 'rule') return;
      block.declarations.forEach((d, declIndex) => {
        if (!isCustomProperty(d.property)) return;
        const name = d.property.trim();
        const baseline = findBaselineValue(baselineBlocks, block.selector, name);
        vars.push({
          name,
          value: d.value,
          baselineValue: baseline ?? '',
          inBaseline: baseline !== null,
          file,
          blockIndex,
          declIndex,
          selector: block.selector
        });
      });
    });
  }
  return vars;
}

/** 固定分组顺序：颜色 → 字体 → 尺寸 → 其它 */
const GROUP_ORDER: ThemeVarKind[] = ['color', 'length', 'font', 'other'];
const GROUP_TITLES: Record<ThemeVarKind, string> = {
  color: '颜色',
  length: '尺寸间距',
  font: '字体',
  other: '其它'
};

/** 按控件类型分组（保持组内原有顺序），空组省略 */
export function groupThemeVariables(vars: ThemeVariable[]): ThemeVarGroup[] {
  const buckets = new Map<ThemeVarKind, ThemeVariable[]>();
  for (const v of vars) {
    const kind = variableKind(v.name, v.value);
    const list = buckets.get(kind);
    if (list) list.push(v);
    else buckets.set(kind, [v]);
  }
  return GROUP_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    key: k,
    title: GROUP_TITLES[k],
    vars: buckets.get(k) as ThemeVariable[]
  }));
}

/** 不可变补丁：替换指定位置的变量值，返回新 blocks 数组 */
export function patchThemeVariable(
  blocks: CssBlock[],
  blockIndex: number,
  declIndex: number,
  value: string
): CssBlock[] {
  const block = blocks[blockIndex];
  if (!block || block.kind !== 'rule') return blocks;
  const decl = block.declarations[declIndex];
  if (!decl || !isCustomProperty(decl.property)) return blocks;
  const nextBlocks = blocks.slice();
  const nextDecls = block.declarations.slice();
  nextDecls[declIndex] = { ...decl, value };
  nextBlocks[blockIndex] = { ...block, declarations: nextDecls };
  return nextBlocks;
}

/* ---------------- 展示辅助 ---------------- */

/** 常用变量名的中文显示名（未命中时把 --my-var 美化为 my var） */
const ZH_NAME_MAP: Record<string, string> = {
  '--ink': '正文文字',
  '--text': '正文文字',
  '--muted': '次要文字',
  '--text-muted': '次要文字',
  '--accent': '强调色',
  '--primary': '主色',
  '--secondary': '辅助色',
  '--line': '分割线',
  '--border': '边框',
  '--border-color': '边框颜色',
  '--bg': '页面背景',
  '--background': '页面背景',
  '--card': '卡片背景',
  '--surface': '区块背景',
  '--link': '链接颜色',
  '--heading': '标题颜色',
  '--radius': '圆角',
  '--border-radius': '圆角',
  '--font': '字体',
  '--font-family': '字体',
  '--font-size': '基础字号',
  '--spacing': '基础间距',
  '--max-width': '内容最大宽度',
  '--shadow': '阴影'
};

export function variableLabel(name: string): string {
  if (ZH_NAME_MAP[name]) return ZH_NAME_MAP[name];
  return name
    .replace(/^--/, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .join(' ');
}

/** 选择器是否为深色主题作用域（用于打「深色」徽标） */
export function isDarkScope(selector: string): boolean {
  return /(^|[\s.#[:])dark\b/i.test(selector) || /data-theme\s*=\s*["']?dark/i.test(selector);
}
