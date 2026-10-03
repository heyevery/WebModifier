// src/components/Editor/PropertyPanel.tsx
// 区段属性编辑面板：根据选中 region 的 type 渲染对应表单
// 支持 text / richtext / image / link / color / list / html

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTemplateStore } from '@/store/template-store';
import { toast } from '@/components/Toast/toast';
import type { Region } from '@shared/types/region';
import type { SectionAction } from '@shared/types/ipc';
import { buildRegionUpdateMessage } from '@shared/region-message';
import { parseListItems } from '@shared/element-utils';
import { buildTemplateUrl, resolveKnownPage, relativePageHref } from '@shared/template-url';

/** 安全解析 JSON 值，失败时返回默认值 */
function safeJsonParse<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function PropertyPanel() {
  const selectedRid = useTemplateStore((s) => s.selectedRid);
  const currentPage = useTemplateStore((s) => s.currentPage);
  const regions = useTemplateStore((s) => s.regions);
  const updateRegionValue = useTemplateStore((s) => s.updateRegionValue);
  const iframeApi = useTemplateStore((s) => s.iframeApi);
  const structureByPage = useTemplateStore((s) => s.structureByPage);
  const regionsByPage = useTemplateStore((s) => s.regionsByPage);

  // 同名标记可能出现在多页，优先匹配当前页
  const region = regions.find(
    (r) => r.page === currentPage && r.anchorRids.includes(selectedRid || '')
  );

  // 全站公共区：统计同 id 出现的页面数（提示同步范围）
  const sharedPageCount = region?.shared
    ? Object.values(regionsByPage).reduce(
        (n, list) => (list.some((r) => r.id === region.id) ? n + 1 : n),
        0
      )
    : 0;

  // 区块实例顺序：有结构变换时以结构表为准，否则取当前页 block region 解析序
  const pageStructure = currentPage ? structureByPage[currentPage] : undefined;
  const blockIds = pageStructure
    ? pageStructure.order.map((inst) => inst.id)
    : regions.filter((r) => r.kind === 'block').map((r) => r.id);
  const blockIndex = region?.kind === 'block' ? blockIds.indexOf(region.id) : -1;

  return (
    <aside className="w-full h-full bg-wt-surface border-l border-wt-border flex flex-col">
      <div className="px-4 py-3 border-b border-wt-border">
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-wt-muted uppercase tracking-[0.15em]">编辑区段</div>
        </div>
        <AnimatePresence mode="wait">
          {region ? (
            <motion.div
              key={region.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <div className="text-base font-semibold text-wt-text mt-1">
                {region.label || region.id}
              </div>
              <div className="text-xs text-wt-muted mt-0.5 flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-wt-primary/15 text-wt-primary font-mono">
                  {region.type}
                </span>
                <span className="text-wt-muted">{region.kind === 'block' ? '块级' : '属性'}</span>
                {region.shared && (
                  <span className="px-1.5 py-0.5 rounded bg-wt-primary text-white text-[10px] font-medium">
                    全站公共
                  </span>
                )}
              </div>
              {region.shared && (
                <div className="text-[11px] text-wt-primary/90 mt-1">
                  修改将同步到所有页面（{sharedPageCount} 页）
                </div>
              )}
            </motion.div>
          ) : (
            <div className="text-base font-medium text-wt-muted mt-1">未选择</div>
          )}
        </AnimatePresence>
        {region?.kind === 'block' && !region.shared && (
          <SectionToolbar
            key={region.id}
            page={region.page}
            id={region.id}
            index={blockIndex}
            total={blockIds.length}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {region ? (
          <RegionEditor
            region={region}
            onChange={(value) => {
              updateRegionValue(region.page, region.id, value);
              iframeApi?.postMessage(buildRegionUpdateMessage(region, value));
            }}
          />
        ) : (
          <div className="text-wt-muted text-sm leading-relaxed">
            <div className="space-y-3">
              <div className="flex gap-2.5 items-start">
                <span className="flex-shrink-0 w-6 h-6 rounded-md bg-wt-primary/15 text-wt-primary flex items-center justify-center text-xs">①</span>
                <p>点击页面中高亮的区域，即可选中并在此编辑内容。</p>
              </div>
              <div className="flex gap-2.5 items-start">
                <span className="flex-shrink-0 w-6 h-6 rounded-md bg-wt-primary/15 text-wt-primary flex items-center justify-center text-xs">②</span>
                <p>文字、图片、链接等修改会实时显示在页面中。</p>
              </div>
              <div className="flex gap-2.5 items-start">
                <span className="flex-shrink-0 w-6 h-6 rounded-md bg-wt-primary/15 text-wt-primary flex items-center justify-center text-xs">③</span>
                <p>在左侧「样式」面板可以可视化调整模板的 CSS 样式。</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/** 块级区段结构操作：上移 / 下移 / 复制 / 删除（删除两步确认） */
function SectionToolbar({
  page,
  id,
  index,
  total
}: {
  page: string;
  id: string;
  index: number;
  total: number;
}) {
  const sectionOp = useTemplateStore((s) => s.sectionOp);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    []
  );

  async function run(action: SectionAction, successMsg?: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await sectionOp(page, action, id);
      if (ok && successMsg) toast.success(successMsg);
    } finally {
      setBusy(false);
    }
  }

  function handleDelete(): void {
    if (!confirming) {
      setConfirming(true);
      confirmTimer.current = setTimeout(() => setConfirming(false), 2500);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    void run('delete', '区块已删除');
  }

  const baseBtn =
    'h-7 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ' +
    'disabled:opacity-35 disabled:cursor-not-allowed';

  return (
    <div className="mt-3">
      <div className="text-[10px] text-wt-muted mb-1.5">区块结构</div>
      <AnimatePresence mode="wait" initial={false}>
        {confirming ? (
          <motion.div
            key="confirm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="grid grid-cols-2 gap-1.5"
          >
            <button
              type="button"
              disabled={busy}
              onClick={handleDelete}
              className={`${baseBtn} bg-wt-danger/15 text-wt-danger hover:bg-wt-danger/25`}
            >
              确认删除
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirmTimer.current) clearTimeout(confirmTimer.current);
                setConfirming(false);
              }}
              className={`${baseBtn} bg-wt-surface-2 text-wt-muted hover:text-wt-text`}
            >
              取消
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="actions"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="grid grid-cols-4 gap-1.5"
          >
            <button
              type="button"
              title="上移区块"
              disabled={busy || index <= 0}
              onClick={() => void run('move-up')}
              className={`${baseBtn} bg-wt-surface-2 text-wt-muted hover:text-wt-text hover:bg-wt-border/60`}
            >
              ↑ 上移
            </button>
            <button
              type="button"
              title="下移区块"
              disabled={busy || index < 0 || index >= total - 1}
              onClick={() => void run('move-down')}
              className={`${baseBtn} bg-wt-surface-2 text-wt-muted hover:text-wt-text hover:bg-wt-border/60`}
            >
              ↓ 下移
            </button>
            <button
              type="button"
              title="复制区块（新块内容与当前一致）"
              disabled={busy || index < 0}
              onClick={() => void run('duplicate', '已复制区块')}
              className={`${baseBtn} bg-wt-primary/15 text-wt-primary hover:bg-wt-primary/25`}
            >
              ⧉ 复制
            </button>
            <button
              type="button"
              title="删除区块"
              disabled={busy || index < 0}
              onClick={handleDelete}
              className={`${baseBtn} bg-wt-surface-2 text-wt-muted hover:text-wt-danger hover:bg-wt-danger/10`}
            >
              ✕ 删除
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RegionEditor({
  region,
  onChange
}: {
  region: Region;
  onChange: (value: string) => void;
}) {
  switch (region.type) {
    case 'text':
    case 'heading': // 标题组件与纯文本共用文本编辑器
      return <TextEditor value={region.value} onChange={onChange} />;
    case 'richtext':
      return <RichTextEditor value={region.value} onChange={onChange} />;
    case 'image':
      return <ImageEditor region={region} onChange={onChange} />;
    case 'link':
      return <LinkEditor value={region.value} page={region.page} onChange={onChange} />;
    case 'color':
      return <ColorEditor region={region} onChange={onChange} />;
    case 'custom-css':
      return <CustomCssEditor value={region.value} onChange={onChange} />;
    case 'list':
      return <ListEditor value={region.value} onChange={onChange} />;
    case 'html':
      return <HtmlEditor value={region.value} onChange={onChange} />;
    case 'video':
      return <VideoEditor value={region.value} onChange={onChange} />;
    case 'audio':
      return <AudioEditor value={region.value} onChange={onChange} />;
    case 'button':
      return <TextEditor value={region.value} onChange={onChange} />;
    case 'divider':
      return <DividerEditor value={region.value} onChange={onChange} />;
    case 'spacer':
      return <SpacerEditor value={region.value} onChange={onChange} />;
    case 'input':
      return <InputEditor value={region.value} onChange={onChange} />;
    case 'textarea':
      return <TextareaEditor value={region.value} onChange={onChange} />;
    case 'select':
      return <SelectEditor value={region.value} onChange={onChange} />;
    case 'checkbox':
      return <CheckboxEditor value={region.value} onChange={onChange} />;
    default:
      return (
        <div className="text-sm text-wt-warning">{region.type} 类型编辑器将在后续版本实现</div>
      );
  }
}

function TextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <label className="block">
      <div className="text-xs font-medium text-wt-muted mb-2">文本内容</div>
      <textarea
        className="w-full h-32 bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40 focus:border-wt-primary/50 resize-none font-mono"
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          onChange(e.target.value);
        }}
        placeholder="输入文本…"
      />
      <div className="text-[10px] text-wt-muted mt-1.5">{local.length} 字符</div>
    </label>
  );
}

function ImageEditor({ region, onChange }: { region: Region; onChange: (v: string) => void }) {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const [picking, setPicking] = useState(false);

  // 值为 JSON {src, alt}；兼容旧格式纯字符串（仅 src）
  const v = safeJsonParse<{ src?: string; alt?: string } | null>(region.value, null);
  const src = v && typeof v === 'object' && typeof v.src === 'string' ? v.src : region.value;
  const alt = v && typeof v === 'object' && typeof v.alt === 'string' ? v.alt : '';
  const update = (patch: { src?: string; alt?: string }): void =>
    onChange(JSON.stringify({ src, alt, ...patch }));

  // 缩略图地址：远程 URL 直接用；相对路径按「页面所在目录」解析（与浏览器语义一致）
  // 模板名/路径可能含中文或空格，必须逐段 percent-encode（buildTemplateUrl）
  const pageDir = region.page.includes('/') ? region.page.slice(0, region.page.lastIndexOf('/')) : '';
  const relPath = `${pageDir ? `${pageDir}/` : ''}${src.replace(/^\.\//, '')}`;
  const thumbSrc = /^(https?:|data:)/.test(src) ? src : buildTemplateUrl(currentTemplate || '', relPath);

  async function handlePick(): Promise<void> {
    if (!currentTemplate || picking) return;
    setPicking(true);
    try {
      const res = await window.wt.pickImage({
        templateName: currentTemplate,
        page: region.page
      });
      if (!res.canceled && res.relativePath) {
        update({ src: res.relativePath });
      }
    } finally {
      setPicking(false);
    }
  }

  return (
    <div>
      <div className="text-xs font-medium text-wt-muted mb-2">图片</div>

      <motion.div
        key={src}
        initial={{ opacity: 0.4, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25 }}
        className="w-full h-36 rounded-md border border-wt-border bg-wt-bg overflow-hidden
                   flex items-center justify-center"
      >
        <img
          src={thumbSrc}
          alt={alt || region.label || region.id}
          className="max-w-full max-h-full object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </motion.div>

      <div className="text-[10px] text-wt-muted mt-1.5 font-mono break-all">
        {src || '（无图片）'}
      </div>

      <button
        onClick={handlePick}
        disabled={picking || !currentTemplate}
        className="mt-3 w-full px-3 py-2 text-sm rounded-md bg-wt-primary/15 text-wt-primary
                   hover:bg-wt-primary/25 transition-colors disabled:opacity-50
                   disabled:cursor-not-allowed"
      >
        {picking ? '选择中…' : '选择本地图片'}
      </button>
      <div className="text-[10px] text-wt-muted mt-1.5 leading-relaxed">
        图片将复制到当前页面同级 assets/ 目录，导出时自动带上。
      </div>

      <label className="block mt-3">
        <div className="text-xs font-medium text-wt-muted mb-2">替代文字 (alt)</div>
        <input
          type="text"
          spellCheck={false}
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm
                     text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40
                     focus:border-wt-primary/50"
          value={alt}
          onChange={(e) => update({ alt: e.target.value })}
          placeholder="图片无法显示时的说明文字"
        />
      </label>
    </div>
  );
}

function LinkEditor({
  value,
  page,
  onChange
}: {
  value: string;
  page: string;
  onChange: (v: string) => void;
}) {
  const pages = useTemplateStore((s) => s.pages);
  const hrefRef = useRef<HTMLInputElement>(null);

  // 值为 JSON {href, text}；兼容旧格式纯字符串（仅 href）
  const parsed = safeJsonParse<{ href?: string; text?: string } | null>(value, null);
  const href = parsed && typeof parsed === 'object' && typeof parsed.href === 'string' ? parsed.href : value;
  const text = parsed && typeof parsed === 'object' && typeof parsed.text === 'string' ? parsed.text : '';
  const update = (patch: { href?: string; text?: string }): void =>
    onChange(JSON.stringify({ href, text, ...patch }));

  /**
   * 快捷前缀：邮箱 mailto: / 电话 tel: / 页内锚点 #
   * 已是该类型则仅聚焦并选中可编辑部分；否则填入前缀模板并聚焦
   */
  function applyHrefPrefix(prefix: string): void {
    if (!href.trim().startsWith(prefix)) update({ href: prefix });
    requestAnimationFrame(() => {
      const el = hrefRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(prefix.length, el.value.length);
    });
  }

  // 当前 href 指向的站内页面（下拉回显）；外部链接/手填值时为空
  const internalTarget = (() => {
    const v = href.trim();
    if (!v || /^(https?:|mailto:|tel:|javascript:|\/\/|#)/i.test(v)) return '';
    return resolveKnownPage(page, v, pages) ?? '';
  })();

  const prefixChips: { id: string; label: string; prefix: string; title: string }[] = [
    { id: 'mail', label: '邮箱', prefix: 'mailto:', title: 'mailto: 邮箱链接，填写邮箱地址' },
    { id: 'tel', label: '电话', prefix: 'tel:', title: 'tel: 电话链接，填写电话号码' },
    { id: 'anchor', label: '页内锚点', prefix: '#', title: '# 锚点链接，填写目标元素的 id' }
  ];

  return (
    <div>
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-2">链接文字</div>
        <input
          type="text"
          spellCheck={false}
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm
                     text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40
                     focus:border-wt-primary/50"
          value={text}
          onChange={(e) => update({ text: e.target.value })}
          placeholder="页面上显示的文字"
        />
      </label>

      <div className="text-xs font-medium text-wt-muted mb-2 mt-3">链接地址 (href)</div>

      {/* 快捷类型：一键填入 mailto:/tel:/# 前缀，再次点击聚焦并选中待填部分 */}
      <div className="flex items-center gap-1 mb-2">
        {prefixChips.map((chip) => {
          const active = href.trim().startsWith(chip.prefix);
          return (
            <button
              key={chip.id}
              type="button"
              title={chip.title}
              onClick={() => applyHrefPrefix(chip.prefix)}
              className={`h-6 px-2 text-[11px] rounded-sm border transition-colors ${
                active
                  ? 'border-wt-primary/50 bg-wt-primary/15 text-wt-primary'
                  : 'border-wt-border text-wt-muted hover:text-wt-text hover:bg-wt-surface-2'
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* 站内页面快捷选择：自动生成相对路径，静态导出同样有效 */}
      {pages.length > 1 && (
        <div className="mb-2">
          <div className="text-[10px] text-wt-muted mb-1">站内页面（点击快速填写）</div>
          <select
            value={internalTarget}
            onChange={(e) => {
              const target = e.target.value;
              if (!target) return;
              update({ href: relativePageHref(page, target) });
            }}
            className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-2 py-1.5 text-xs text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40"
          >
            <option value="">— 外部链接 / 手动填写 —</option>
            {pages.map((p) => (
              <option key={p} value={p}>
                {p === page ? `${p}（当前页）` : p}
              </option>
            ))}
          </select>
        </div>
      )}

      <input
        ref={hrefRef}
        type="text"
        spellCheck={false}
        className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm
                   text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40
                   focus:border-wt-primary/50 font-mono"
        value={href}
        onChange={(e) => update({ href: e.target.value })}
        placeholder="https://example.com"
      />
      <div className="text-[10px] text-wt-muted mt-1.5">
        支持网页地址、mailto: 邮箱、tel: 电话、# 页内锚点等任意 href 值；选择站内页面会自动填好相对路径。
      </div>
    </div>
  );
}

const COLOR_PROPS = ['color', 'background-color', 'border-color'] as const;

function ColorEditor({ region, onChange }: { region: Region; onChange: (v: string) => void }) {
  // 新格式为 JSON { prop, value }；兼容旧格式纯颜色字符串
  const parsed = safeJsonParse<{ prop?: string; value?: string } | null>(region.value, null);
  const isNewFormat = !!parsed && typeof parsed === 'object' && ('prop' in parsed || 'value' in parsed);
  const prop = isNewFormat && parsed.prop ? parsed.prop : region.prop || 'color';
  const rawValue = isNewFormat && typeof parsed.value === 'string' ? parsed.value : region.value;

  function update(newProp: string, newValue: string) {
    onChange(JSON.stringify({ prop: newProp, value: newValue }));
  }

  // input[type=color] 只接受 #rrggbb；其他格式（rgb()/命名色）回退显示时保持原值
  const isHex = /^#[0-9a-fA-F]{6}$/.test(rawValue);
  const pickerValue = isHex ? rawValue : '#000000';

  return (
    <div>
      <div className="text-xs font-medium text-wt-muted mb-2">目标 CSS 属性</div>
      <select
        value={prop}
        onChange={(e) => update(e.target.value, rawValue)}
        className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40 mb-3"
      >
        {COLOR_PROPS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <div className="relative w-10 h-10 rounded-md overflow-hidden border border-wt-border flex-shrink-0">
          <input
            type="color"
            value={pickerValue}
            onChange={(e) => update(prop, e.target.value)}
            className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] cursor-pointer
                       bg-transparent border-0 p-0"
            title="选择颜色"
          />
        </div>
        <input
          type="text"
          spellCheck={false}
          className="flex-1 bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm
                     text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40
                     focus:border-wt-primary/50 font-mono"
          value={rawValue}
          onChange={(e) => update(prop, e.target.value)}
          placeholder="#5b5bd6 或 rgb()"
        />
      </div>

      <div className="text-[10px] text-wt-muted mt-1.5 leading-relaxed">
        可输入任意 CSS 颜色值，实时应用到 <span className="font-mono">{prop}</span> 属性。
      </div>
    </div>
  );
}

function RichTextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // 外部值变化时同步到 DOM（仅在真正不同步时写入，避免光标跳动）
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
  }, [value]);

  // 注：document.execCommand 已标记废弃但浏览器全面支持，
  // 作为零依赖轻量富文本方案在此使用
  function exec(cmd: string, arg?: string): void {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function handleLink(): void {
    const url = window.prompt('输入链接地址', 'https://');
    if (url) exec('createLink', url);
  }

  // preventDefault 保持选区不丢失
  const btnClass =
    'px-2 py-0.5 rounded text-xs text-wt-muted hover:text-wt-text hover:bg-wt-surface transition-colors';

  return (
    <div>
      <div className="text-xs font-medium text-wt-muted mb-2">富文本</div>
      <div className="flex items-center gap-0.5 mb-2 px-1 py-1 rounded-md bg-wt-surface-2 border border-wt-border">
        <button className={btnClass} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} title="加粗">
          <b>B</b>
        </button>
        <button className={btnClass} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} title="斜体">
          <i>I</i>
        </button>
        <button className={btnClass} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} title="下划线">
          <u>U</u>
        </button>
        <div className="w-px h-4 bg-wt-border mx-1" />
        <button className={btnClass} onMouseDown={(e) => e.preventDefault()} onClick={handleLink} title="插入链接">
          链接
        </button>
        <button className={btnClass} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')} title="清除格式">
          清除格式
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className="w-full min-h-32 max-h-52 overflow-y-auto bg-wt-surface-2 border border-wt-border
                   rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2
                   focus:ring-wt-primary/40 leading-relaxed"
      />
      <div className="text-[10px] text-wt-muted mt-1.5">选中文本后点击工具栏按钮设置格式。</div>
    </div>
  );
}

function ListEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const items = parseListItems(value);

  function commit(next: string[]): void {
    onChange(JSON.stringify(next));
  }

  function update(i: number, v: string): void {
    const next = [...items];
    next[i] = v;
    commit(next);
  }

  function remove(i: number): void {
    commit(items.filter((_, x) => x !== i));
  }

  function move(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  }

  const iconBtn =
    'w-6 h-6 flex items-center justify-center rounded text-wt-muted hover:text-wt-text ' +
    'hover:bg-wt-surface transition-colors text-xs disabled:opacity-30 disabled:cursor-not-allowed';

  return (
    <div>
      <div className="text-xs font-medium text-wt-muted mb-2">
        列表项 <span className="text-wt-primary/80">({items.length})</span>
      </div>

      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {items.map((item, i) => (
            <motion.div
              key={`${i}-${items.length}`}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-1"
            >
              <span className="w-5 text-[10px] text-wt-muted font-mono text-right flex-shrink-0">
                {i + 1}
              </span>
              <input
                value={item}
                onChange={(e) => update(i, e.target.value)}
                className="flex-1 min-w-0 bg-wt-surface-2 border border-wt-border rounded-md px-2.5 py-1.5
                           text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40
                           focus:border-wt-primary/50"
                placeholder="列表项内容…"
              />
              <button className={iconBtn} onClick={() => move(i, -1)} disabled={i === 0} title="上移">
                ↑
              </button>
              <button
                className={iconBtn}
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                title="下移"
              >
                ↓
              </button>
              <button className={iconBtn} onClick={() => remove(i)} title="删除">
                ✕
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <button
        onClick={() => commit([...items, ''])}
        className="mt-2 w-full px-3 py-1.5 text-xs rounded-md bg-wt-primary/15 text-wt-primary
                   hover:bg-wt-primary/25 transition-colors"
      >
        ＋ 添加一项
      </button>
    </div>
  );
}

function HtmlEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <label className="block">
      <div className="text-xs font-medium text-wt-muted mb-2">HTML 源码</div>
      <textarea
        spellCheck={false}
        className="w-full h-48 bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-xs
                   text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40
                   focus:border-wt-primary/50 resize-y font-mono leading-relaxed"
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          onChange(e.target.value);
        }}
        placeholder="输入 HTML 片段…"
      />
      <div className="text-[10px] text-wt-muted mt-1.5 leading-relaxed">
        替换标记内首元素的内部 HTML，原样写回导出文件。
      </div>
    </label>
  );
}

// ========== 二级工作新增组件编辑器 ==========

function VideoEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = safeJsonParse(value, { src: '', poster: '', controls: true });
  function update(patch: Partial<typeof v>) {
    onChange(JSON.stringify({ ...v, ...patch }));
  }
  return (
    <div className="space-y-3">
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-1.5">视频源 (src)</div>
        <input
          type="text"
          value={v.src}
          onChange={(e) => update({ src: e.target.value })}
          placeholder="video.mp4 或 https://..."
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40 font-mono"
        />
      </label>
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-1.5">封面 (poster)</div>
        <input
          type="text"
          value={v.poster}
          onChange={(e) => update({ poster: e.target.value })}
          placeholder="poster.jpg（可选）"
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40 font-mono"
        />
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={v.controls}
          onChange={(e) => update({ controls: e.target.checked })}
          className="w-4 h-4 accent-wt-primary"
        />
        <span className="text-sm text-wt-text">显示控制条</span>
      </label>
    </div>
  );
}

function AudioEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = safeJsonParse(value, { src: '', controls: true });
  function update(patch: Partial<typeof v>) {
    onChange(JSON.stringify({ ...v, ...patch }));
  }
  return (
    <div className="space-y-3">
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-1.5">音频源 (src)</div>
        <input
          type="text"
          value={v.src}
          onChange={(e) => update({ src: e.target.value })}
          placeholder="audio.mp3"
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40 font-mono"
        />
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={v.controls}
          onChange={(e) => update({ controls: e.target.checked })}
          className="w-4 h-4 accent-wt-primary"
        />
        <span className="text-sm text-wt-text">显示控制条</span>
      </label>
    </div>
  );
}

function DividerEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = safeJsonParse(value, { style: '', color: '#2a2f3a' });
  function update(patch: Partial<typeof v>) {
    onChange(JSON.stringify({ ...v, ...patch }));
  }
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-medium text-wt-muted mb-1.5">颜色</div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : '#2a2f3a'}
            onChange={(e) => update({ color: e.target.value })}
            className="w-10 h-10 rounded cursor-pointer bg-transparent border-0"
          />
          <input
            type="text"
            value={v.color}
            onChange={(e) => update({ color: e.target.value })}
            className="flex-1 bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text font-mono"
          />
        </div>
      </div>
    </div>
  );
}

function SpacerEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value || '20px');
  useEffect(() => setLocal(value || '20px'), [value]);
  const px = parseInt(local) || 20;
  return (
    <div>
      <div className="text-xs font-medium text-wt-muted mb-2">
        间距高度 <span className="text-wt-primary/80 font-mono">{local}</span>
      </div>
      <input
        type="range"
        min="0"
        max="200"
        value={px}
        onChange={(e) => {
          const v = `${e.target.value}px`;
          setLocal(v);
          onChange(v);
        }}
        className="wt-range"
        style={{ ['--wt-pct' as string]: `${Math.round((px / 200) * 100)}%` }}
      />
      <input
        type="text"
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          onChange(e.target.value);
        }}
        className="mt-2 w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-1.5 text-sm text-wt-text font-mono"
      />
    </div>
  );
}

function InputEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = safeJsonParse(value, { type: 'text', placeholder: '', value: '' });
  function update(patch: Partial<typeof v>) {
    onChange(JSON.stringify({ ...v, ...patch }));
  }
  return (
    <div className="space-y-3">
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-1.5">类型</div>
        <select
          value={v.type}
          onChange={(e) => update({ type: e.target.value })}
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40"
        >
          <option value="text">text</option>
          <option value="email">email</option>
          <option value="password">password</option>
          <option value="number">number</option>
          <option value="tel">tel</option>
          <option value="url">url</option>
          <option value="date">date</option>
        </select>
      </label>
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-1.5">占位符 (placeholder)</div>
        <input
          type="text"
          value={v.placeholder}
          onChange={(e) => update({ placeholder: e.target.value })}
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40"
        />
      </label>
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-1.5">默认值 (value)</div>
        <input
          type="text"
          value={v.value}
          onChange={(e) => update({ value: e.target.value })}
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40"
        />
      </label>
    </div>
  );
}

function TextareaEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = safeJsonParse(value, { placeholder: '', value: '' });
  function update(patch: Partial<typeof v>) {
    onChange(JSON.stringify({ ...v, ...patch }));
  }
  return (
    <div className="space-y-3">
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-1.5">占位符</div>
        <input
          type="text"
          value={v.placeholder}
          onChange={(e) => update({ placeholder: e.target.value })}
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40"
        />
      </label>
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-1.5">内容</div>
        <textarea
          value={v.value}
          onChange={(e) => update({ value: e.target.value })}
          className="w-full h-24 bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40 resize-none"
        />
      </label>
    </div>
  );
}

function SelectEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = safeJsonParse(value, { options: [] as { label: string; value: string }[], value: '' });
  function update(patch: Partial<typeof v>) {
    onChange(JSON.stringify({ ...v, ...patch }));
  }
  function updateOption(i: number, patch: Partial<{ label: string; value: string }>) {
    const options = v.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o));
    update({ options });
  }
  function addOption() {
    update({ options: [...v.options, { label: '新选项', value: `option${v.options.length + 1}` }] });
  }
  function removeOption(i: number) {
    update({ options: v.options.filter((_, idx) => idx !== i) });
  }
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-wt-muted">选项列表</div>
      {v.options.map((opt, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={opt.label}
            onChange={(e) => updateOption(i, { label: e.target.value })}
            placeholder="显示文本"
            className="flex-1 min-w-0 bg-wt-surface-2 border border-wt-border rounded-md px-2 py-1.5 text-xs text-wt-text focus:outline-none focus:ring-1 focus:ring-wt-primary/40"
          />
          <input
            type="text"
            value={opt.value}
            onChange={(e) => updateOption(i, { value: e.target.value })}
            placeholder="值"
            className="w-20 bg-wt-surface-2 border border-wt-border rounded-md px-2 py-1.5 text-xs text-wt-text focus:outline-none focus:ring-1 focus:ring-wt-primary/40 font-mono"
          />
          <button
            onClick={() => removeOption(i)}
            className="w-6 h-6 flex items-center justify-center rounded text-wt-muted hover:text-wt-danger hover:bg-wt-surface"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={addOption}
        className="w-full px-2 py-1 text-xs rounded-md bg-wt-primary/15 text-wt-primary hover:bg-wt-primary/25"
      >
        ＋ 添加选项
      </button>
      <label className="block pt-2">
        <div className="text-xs font-medium text-wt-muted mb-1.5">默认选中值</div>
        <select
          value={v.value}
          onChange={(e) => update({ value: e.target.value })}
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40"
        >
          <option value="">（无默认）</option>
          {v.options.map((o, i) => (
            <option key={i} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function CheckboxEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = safeJsonParse(value, { checked: false, label: '' });
  function update(patch: Partial<typeof v>) {
    onChange(JSON.stringify({ ...v, ...patch }));
  }
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={v.checked}
          onChange={(e) => update({ checked: e.target.checked })}
          className="w-4 h-4 accent-wt-primary"
        />
        <span className="text-sm text-wt-text">默认选中</span>
      </label>
      <label className="block">
        <div className="text-xs font-medium text-wt-muted mb-1.5">标签文本</div>
        <input
          type="text"
          value={v.label}
          onChange={(e) => update({ label: e.target.value })}
          className="w-full bg-wt-surface-2 border border-wt-border rounded-md px-3 py-2 text-sm text-wt-text focus:outline-none focus:ring-2 focus:ring-wt-primary/40"
        />
      </label>
    </div>
  );
}

function CustomCssEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parseRows = (v: string): [string, string][] =>
    Object.entries(safeJsonParse<Record<string, string>>(v, {}));
  // 本地行状态：允许空属性名行在编辑过程中保留（提交时过滤）
  const [rows, setRows] = useState<[string, string][]>(() => parseRows(value));

  // 外部值变化（撤销/重做/切换区段）时重置本地行
  useEffect(() => {
    const parsed = parseRows(value);
    setRows((prev) => {
      const filtered = prev.filter(([k]) => k.trim());
      return JSON.stringify(parsed) === JSON.stringify(filtered) ? prev : parsed;
    });
  }, [value]);

  function commit(next: [string, string][]) {
    setRows(next);
    const obj: Record<string, string> = {};
    for (const [k, v] of next) {
      const key = k.trim();
      if (key) obj[key] = v;
    }
    onChange(JSON.stringify(obj));
  }

  function updateEntry(i: number, patch: { prop?: string; val?: string }) {
    const next = rows.map(([k, v], idx) =>
      idx === i
        ? ([patch.prop !== undefined ? patch.prop : k, patch.val !== undefined ? patch.val : v] as [string, string])
        : ([k, v] as [string, string])
    );
    commit(next);
  }

  function removeEntry(i: number) {
    commit(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-wt-muted">
        CSS 属性 <span className="text-wt-primary/80">({rows.length})</span>
      </div>
      {rows.map(([prop, val], i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={prop}
            onChange={(e) => updateEntry(i, { prop: e.target.value })}
            placeholder="属性名，如 margin-top"
            spellCheck={false}
            className="w-[44%] min-w-0 bg-wt-surface-2 border border-wt-border rounded-md px-2 py-1.5 text-xs text-wt-text focus:outline-none focus:ring-1 focus:ring-wt-primary/40 font-mono"
          />
          <input
            type="text"
            value={val}
            onChange={(e) => updateEntry(i, { val: e.target.value })}
            placeholder="值"
            spellCheck={false}
            className="flex-1 min-w-0 bg-wt-surface-2 border border-wt-border rounded-md px-2 py-1.5 text-xs text-wt-text focus:outline-none focus:ring-1 focus:ring-wt-primary/40 font-mono"
          />
          <button
            onClick={() => removeEntry(i)}
            className="w-6 h-6 flex items-center justify-center rounded text-wt-muted hover:text-wt-danger hover:bg-wt-surface"
            title="删除该属性"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() => commit([...rows, ['', '']])}
        className="w-full px-2 py-1 text-xs rounded-md bg-wt-primary/15 text-wt-primary hover:bg-wt-primary/25 transition-colors"
      >
        ＋ 添加属性
      </button>
      <div className="text-[10px] text-wt-muted mt-1.5 leading-relaxed">
        以 <span className="font-mono">{'{ prop: value }'}</span> 形式存储，导出时整体写回元素 style。
      </div>
    </div>
  );
}
