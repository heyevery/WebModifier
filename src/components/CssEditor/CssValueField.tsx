// src/components/CssEditor/CssValueField.tsx
// 根据 CSS 属性名智能渲染可视化输入控件：
// 颜色属性 → 取色器；尺寸属性 → 数字+单位；枚举属性 → 下拉；透明度 → 滑块；
// 无法识别（如 calc、渐变、复合值）→ 原始文本输入。始终可切换回代码模式。

import { useMemo, useRef } from 'react';

/* ---------------- 属性元数据（小白友好中文名） ---------------- */

export const PROPERTY_LABELS: Record<string, string> = {
  color: '文字颜色',
  'background-color': '背景颜色',
  background: '背景',
  'border-color': '边框颜色',
  'border-top-color': '上边框颜色',
  'border-bottom-color': '下边框颜色',
  'border-left-color': '左边框颜色',
  'border-right-color': '右边框颜色',
  'outline-color': '描边颜色',
  'text-decoration-color': '装饰线颜色',
  'caret-color': '光标颜色',
  'font-size': '字号',
  'font-weight': '字重',
  'font-family': '字体',
  'font-style': '字体样式',
  'line-height': '行高',
  'letter-spacing': '字间距',
  'word-spacing': '词间距',
  'text-align': '文字对齐',
  'text-transform': '大小写',
  'text-decoration': '文字装饰',
  'text-indent': '首行缩进',
  width: '宽度',
  height: '高度',
  'min-width': '最小宽度',
  'max-width': '最大宽度',
  'min-height': '最小高度',
  'max-height': '最大高度',
  padding: '内边距',
  'padding-top': '上内边距',
  'padding-right': '右内边距',
  'padding-bottom': '下内边距',
  'padding-left': '左内边距',
  margin: '外边距',
  'margin-top': '上外边距',
  'margin-right': '右外边距',
  'margin-bottom': '下外边距',
  'margin-left': '左外边距',
  top: '顶部定位',
  right: '右侧定位',
  bottom: '底部定位',
  left: '左侧定位',
  gap: '间距',
  'row-gap': '行间距',
  'column-gap': '列间距',
  'border-radius': '圆角',
  'border-width': '边框粗细',
  'border-style': '边框样式',
  border: '边框',
  display: '显示方式',
  position: '定位方式',
  opacity: '不透明度',
  overflow: '溢出处理',
  'overflow-x': '横向溢出',
  'overflow-y': '纵向溢出',
  cursor: '鼠标样式',
  visibility: '可见性',
  'z-index': '层级',
  'flex-direction': '排列方向',
  'flex-wrap': '换行',
  'justify-content': '主轴对齐',
  'align-items': '交叉轴对齐',
  'align-content': '多行对齐',
  'align-self': '自身对齐',
  flex: '弹性比例',
  'white-space': '空白处理',
  'object-fit': '填充方式',
  'background-repeat': '背景平铺',
  'background-size': '背景尺寸',
  'background-position': '背景位置',
  'vertical-align': '垂直对齐',
  'box-shadow': '阴影',
  'text-shadow': '文字阴影',
  transition: '过渡动画',
  transform: '变换'
};

/** datalist 自动补全使用的属性名列表 */
export const KNOWN_PROPERTIES = Object.keys(PROPERTY_LABELS);

const COLOR_PROPS = new Set([
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-bottom-color',
  'border-left-color',
  'border-right-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'fill',
  'stroke'
]);

const LENGTH_PROPS = new Set([
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-indent',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'top',
  'right',
  'bottom',
  'left',
  'gap',
  'row-gap',
  'column-gap',
  'border-radius',
  'border-width',
  'border-top-width',
  'border-bottom-width',
  'border-left-width',
  'border-right-width'
]);

const LENGTH_UNITS = ['px', '%', 'em', 'rem', 'vw', 'vh', ''];

const ENUM_PROPS: Record<string, string[]> = {
  display: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'none'],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  'text-align': ['left', 'center', 'right', 'justify'],
  'font-weight': ['300', '400', '500', '600', '700', '800', 'normal', 'bold'],
  'font-style': ['normal', 'italic', 'oblique'],
  'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
  'text-decoration': ['none', 'underline', 'overline', 'line-through'],
  'border-style': ['none', 'solid', 'dashed', 'dotted', 'double'],
  overflow: ['visible', 'hidden', 'scroll', 'auto'],
  'overflow-x': ['visible', 'hidden', 'scroll', 'auto'],
  'overflow-y': ['visible', 'hidden', 'scroll', 'auto'],
  cursor: ['default', 'pointer', 'text', 'move', 'not-allowed', 'help', 'wait', 'crosshair'],
  visibility: ['visible', 'hidden', 'collapse'],
  'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
  'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'justify-content': ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  'align-items': ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
  'align-content': ['stretch', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around'],
  'align-self': ['auto', 'flex-start', 'center', 'flex-end', 'stretch'],
  'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'],
  'object-fit': ['fill', 'contain', 'cover', 'none', 'scale-down'],
  'background-repeat': ['repeat', 'repeat-x', 'repeat-y', 'no-repeat'],
  'background-size': ['auto', 'cover', 'contain', '100% 100%'],
  'background-position': ['left top', 'center', 'right bottom', 'left center', 'right center'],
  'vertical-align': ['baseline', 'top', 'middle', 'bottom', 'text-top', 'text-bottom']
};

/* ---------------- 颜色工具 ---------------- */

let probeEl: HTMLDivElement | null = null;

/** 长期挂载的隐藏探针元素，用 getComputedStyle 把任意 CSS 颜色归一化为 rgb */
function getProbe(): HTMLDivElement {
  if (!probeEl) {
    probeEl = document.createElement('div');
    probeEl.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;opacity:0;';
    document.body.appendChild(probeEl);
  }
  return probeEl;
}

interface ParsedColor {
  /** #rrggbb（供原生取色器使用） */
  hex: string;
  /** 0-1 */
  alpha: number;
}

function toHexByte(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0');
}

/** 把任意浏览器可识别的 CSS 颜色解析为 hex + alpha；不支持（var/渐变等）返回 null */
function parseColor(raw: string): ParsedColor | null {
  const v = raw.trim();
  if (!v || v.startsWith('var(') || v.includes('gradient') || v === 'currentColor' || v === 'inherit' || v === 'unset') {
    return null;
  }
  const probe = getProbe();
  probe.style.color = '';
  probe.style.color = v;
  if (!probe.style.color) return null;
  const computed = getComputedStyle(probe).color;
  const m = computed.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => s.trim());
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  if ([r, g, b].some(Number.isNaN)) return null;
  const alpha = parts[3] !== undefined ? Number(parts[3]) : 1;
  return { hex: `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`, alpha: Number.isNaN(alpha) ? 1 : alpha };
}

/** hex(#rrggbb) → "r, g, b" */
function hexToRgbTriple(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/* ---------------- 控件类型判定 ---------------- */

type ControlKind = 'color' | 'length' | 'enum' | 'opacity' | 'raw';

const LENGTH_RE = /^-?\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh|vmin|vmax|pt|pc|in|cm|mm)?$/;
const OPACITY_RE = /^(?:0|1|0?\.\d+)$/;

function resolveKind(property: string, value: string): ControlKind {
  const p = property.trim().toLowerCase();
  if (COLOR_PROPS.has(p)) return 'color';
  // background 简写：值恰好是纯色时按颜色处理，否则（渐变/图片）走原始输入
  if (p === 'background' && (!value.trim() || parseColor(value))) return 'color';
  if (LENGTH_PROPS.has(p)) {
    const v = value.trim();
    return v === '' || LENGTH_RE.test(v) ? 'length' : 'raw';
  }
  if (ENUM_PROPS[p]) return 'enum';
  if (p === 'opacity') {
    const v = value.trim();
    return v === '' || OPACITY_RE.test(v) ? 'opacity' : 'raw';
  }
  return 'raw';
}

/* ---------------- 共用样式 ---------------- */

const inputCls =
  'flex-1 min-w-0 bg-wt-bg border border-wt-border rounded px-1.5 py-1 text-[11px] font-mono text-wt-text placeholder:text-wt-muted/50 focus:outline-none focus:ring-1 focus:ring-wt-primary/40';

/* ---------------- 颜色控件 ---------------- */

function ColorControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseColor(value), [value]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => pickerRef.current?.click()}
          className="w-6 h-6 rounded border border-wt-border flex-shrink-0 shadow-sm"
          style={{
            // 注意：只能用 backgroundColor 长写属性，与下方 backgroundImage 等同属长写，
            // 混用 background 简写会触发 React「简写/长写冲突」警告并导致样式覆盖
            backgroundColor: parsed ? parsed.hex : value || 'transparent',
            backgroundImage:
              'linear-gradient(45deg, #888 25%, transparent 25%), linear-gradient(-45deg, #888 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #888 75%), linear-gradient(-45deg, transparent 75%, #888 75%)',
            backgroundSize: '6px 6px',
            backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0'
          }}
          title="点击打开取色器"
        >
          <span
            className="block w-full h-full rounded-sm"
            style={{ backgroundColor: value || 'transparent' }}
          />
        </button>
        <input
          ref={pickerRef}
          type="color"
          className="hidden"
          value={parsed?.hex ?? '#000000'}
          onChange={(e) => {
            // 保留原有透明度（输出 8 位 hex）
            const hex = e.target.value;
            onChange(parsed && parsed.alpha < 1 ? `${hex}${toHexByte(parsed.alpha * 255)}` : hex);
          }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#ffffff / red / rgb(...)"
          className={inputCls}
          spellCheck={false}
        />
      </div>
      {parsed && parsed.alpha < 1 && (
        <div className="flex items-center gap-1.5 pl-7">
          <span className="text-[9px] text-wt-muted w-8 flex-shrink-0">透明</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={parsed.alpha}
            onChange={(e) => {
              const a = Number(e.target.value);
              onChange(a >= 1 ? parsed.hex : `rgba(${hexToRgbTriple(parsed.hex)}, ${a})`);
            }}
            className="wt-range flex-1"
            style={{ ['--wt-pct' as string]: `${Math.round(parsed.alpha * 100)}%` }}
          />
          <span className="text-[10px] font-mono text-wt-muted w-8 text-right">{Math.round(parsed.alpha * 100)}%</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- 尺寸控件 ---------------- */

function LengthControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/);
  const num = m ? Number(m[1]) : 0;
  const unit = m ? m[2] : 'px';

  const emit = (n: number, u: string) => {
    onChange(n === 0 && u === '' ? '0' : `${n}${u}`);
  };

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={m ? num : 0}
        step="1"
        onChange={(e) => emit(Number(e.target.value), unit)}
        className={inputCls}
      />
      <select
        value={LENGTH_UNITS.includes(unit) ? unit : 'px'}
        onChange={(e) => emit(num || 0, e.target.value)}
        className="w-[52px] flex-shrink-0 bg-wt-bg border border-wt-border rounded px-1 py-1 text-[11px] text-wt-muted focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
        title="单位"
      >
        {LENGTH_UNITS.map((u) => (
          <option key={u || 'none'} value={u}>
            {u === '' ? '无' : u}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ---------------- 枚举下拉控件 ---------------- */

function EnumControl({
  value,
  options,
  onChange
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const known = options.includes(value.trim());
  return (
    <select
      value={known ? value : '__custom__'}
      onChange={(e) => e.target.value !== '__custom__' && onChange(e.target.value)}
      className="w-full bg-wt-bg border border-wt-border rounded px-1.5 py-1 text-[11px] text-wt-text focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
    >
      {!known && value.trim() !== '' && <option value="__custom__">{value}（自定义）</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/* ---------------- 透明度滑块控件 ---------------- */

function OpacityControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = value.trim() === '' ? 1 : Number(value);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={Number.isNaN(v) ? 1 : v}
        onChange={(e) => onChange(e.target.value)}
        className="wt-range flex-1"
        style={{ ['--wt-pct' as string]: `${Math.round((Number.isNaN(v) ? 1 : v) * 100)}%` }}
      />
      <input
        type="number"
        min={0}
        max={1}
        step={0.05}
        value={Number.isNaN(v) ? 1 : v}
        onChange={(e) => onChange(e.target.value)}
        className="w-14 flex-shrink-0 bg-wt-bg border border-wt-border rounded px-1.5 py-1 text-[11px] font-mono text-wt-text focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
      />
    </div>
  );
}

/* ---------------- 原始文本控件 ---------------- */

function RawControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="任意 CSS 值" className={inputCls} spellCheck={false} />;
}

/* ---------------- 入口组件 ---------------- */

export function CssValueField({
  property,
  value,
  onChange
}: {
  property: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const kind = useMemo(() => resolveKind(property, value), [property, value]);

  switch (kind) {
    case 'color':
      return <ColorControl value={value} onChange={onChange} />;
    case 'length':
      return <LengthControl value={value} onChange={onChange} />;
    case 'enum':
      return <EnumControl value={value} options={ENUM_PROPS[property.trim().toLowerCase()] ?? []} onChange={onChange} />;
    case 'opacity':
      return <OpacityControl value={value} onChange={onChange} />;
    default:
      return <RawControl value={value} onChange={onChange} />;
  }
}
