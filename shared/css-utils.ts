// shared/css-utils.ts
// 轻量 CSS 解析 / 序列化（正则 + 字符扫描，不引入大型依赖）
// main 与 renderer 共用：main 用于读写 CSS 文件，renderer 用于实时预览序列化

// 单条 CSS 声明（键值对）
export interface CssDeclaration {
  property: string;
  value: string;
}

// CSS 顶层块：
// - comment：注释，原样保留
// - atrule：@media / @keyframes / @font-face / @import 等，整块原样保留（不做可视化编辑）
// - rule：普通规则（选择器 + 声明列表），可视化编辑对象
export type CssBlock =
  | { kind: 'comment'; text: string }
  | { kind: 'atrule'; raw: string }
  | { kind: 'rule'; selector: string; declarations: CssDeclaration[] };

// 解析声明体（大括号内的文本）为键值对数组
// 支持值中包含分号（括号/字符串保护），忽略无法识别为 prop: value 的片段
export function parseDeclarations(body: string): CssDeclaration[] {
  const decls: CssDeclaration[] = [];
  let cur = '';
  let inStr: string | null = null;
  let paren = 0;

  const flush = () => {
    const t = cur.trim();
    cur = '';
    if (!t) return;
    const ci = t.indexOf(':');
    if (ci === -1) return;
    const property = t.slice(0, ci).trim();
    const value = t.slice(ci + 1).trim();
    if (property) decls.push({ property, value });
  };

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      cur += c;
      if (c === '\\') {
        cur += body[i + 1] ?? '';
        i++;
      } else if (c === inStr) {
        inStr = null;
      }
      continue;
    }
    // 声明体内的注释：跳过，避免污染属性名
    if (c === '/' && body[i + 1] === '*') {
      const end = body.indexOf('*/', i + 2);
      i = end === -1 ? body.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      cur += c;
      continue;
    }
    if (c === '(') paren++;
    else if (c === ')') paren--;
    if (c === ';' && paren === 0) {
      flush();
      continue;
    }
    cur += c;
  }
  flush();
  return decls;
}

// 解析完整 CSS 文本为顶层块数组
export function parseCss(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const n = css.length;
  let i = 0;

  while (i < n) {
    // 跳过空白
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;

    // 注释块：原样保留
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blocks.push({ kind: 'comment', text: css.slice(i, stop) });
      i = stop;
      continue;
    }

    // 读取 prelude（选择器或 at 规则头）直到 { 或 ;
    let j = i;
    let inStr: string | null = null;
    let paren = 0;
    while (j < n) {
      const c = css[j];
      if (inStr) {
        if (c === '\\') j++;
        else if (c === inStr) inStr = null;
      } else if (c === '"' || c === "'") {
        inStr = c;
      } else if (c === '(') {
        paren++;
      } else if (c === ')') {
        paren--;
      } else if (paren === 0 && (c === '{' || c === ';')) {
        break;
      }
      j++;
    }
    const prelude = css.slice(i, j).trim();

    if (j >= n) {
      // 文件末尾的裸文本：作为无声明体的规则保留
      if (prelude) blocks.push({ kind: 'rule', selector: prelude, declarations: [] });
      break;
    }

    // @import 等无大括号语句：原样保留
    if (css[j] === ';') {
      blocks.push({ kind: 'atrule', raw: css.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    // css[j] === '{'：找匹配的闭括号（考虑字符串 / 注释 / 嵌套）
    let depth = 1;
    let k = j + 1;
    inStr = null;
    while (k < n && depth > 0) {
      const c = css[k];
      if (inStr) {
        if (c === '\\') k++;
        else if (c === inStr) inStr = null;
      } else if (c === '"' || c === "'") {
        inStr = c;
      } else if (c === '/' && css[k + 1] === '*') {
        const cEnd = css.indexOf('*/', k + 2);
        k = (cEnd === -1 ? n : cEnd + 2) - 1; // -1 抵消循环末尾 k++
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
      }
      k++;
    }
    const body = css.slice(j + 1, k - 1);

    if (prelude.startsWith('@')) {
      // @media / @keyframes / @font-face 等：整块原样保留
      blocks.push({ kind: 'atrule', raw: css.slice(i, k) });
    } else {
      blocks.push({ kind: 'rule', selector: prelude, declarations: parseDeclarations(body) });
    }
    i = k;
  }

  return blocks;
}

// 将块数组序列化回 CSS 文本
// 注释与 at 规则原样输出；普通规则统一格式化为两行缩进风格
export function serializeCss(blocks: CssBlock[]): string {
  const out = blocks
    .map((b) => {
      if (b.kind === 'comment') return b.text;
      if (b.kind === 'atrule') return b.raw;
      const decls = b.declarations
        .filter((d) => d.property.trim())
        .map((d) => `  ${d.property.trim()}: ${d.value};`)
        .join('\n');
      return `${b.selector} {\n${decls}\n}`;
    })
    .join('\n\n');
  return out ? `${out}\n` : '';
}
