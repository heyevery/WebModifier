// shared/types/region.ts
// main 进程与 renderer 进程共享的可编辑区段类型契约

export const EDITABLE_TYPES = [
  'text',
  'richtext',
  'image',
  'link',
  'color',
  'list',
  'html',
  // 标题组件（拖入的 heading，编辑体验与 text 一致）
  'heading',
  // 二级工作新增类型
  'video',
  'audio',
  'button',
  'divider',
  'spacer',
  'input',
  'textarea',
  'select',
  'checkbox',
  // 自定义 CSS：直接编辑任意 CSS 属性（JSON 键值对）
  'custom-css'
] as const;

export type EditableType = (typeof EDITABLE_TYPES)[number];

// 标记位置类型：块注释 vs 单元素属性
export type RegionKind = 'block' | 'attr';

// 单个可编辑区段
export interface Region {
  id: string; // 来自标记 name
  kind: RegionKind;
  type: EditableType;
  label?: string;
  // color 类型：要修改的 CSS 属性名（默认 color），如 background-color / border-color
  prop?: string;
  // 所属页面（相对模板根的 POSIX 路径，如 "index.html"、"about.html"）
  page: string;
  // 区域内所有节点注入的 data-wt-rid 锚点 ID
  anchorRids: string[];
  // 当前值（text 类型为字符串）
  value: string;
  // 全站公共区（@wt:shared / data-wt-shared）：同名标记跨页面共享同一个值，
  // 编辑一处同步到所有出现页；草稿单独存 sharedEdits，不进按页 edits
  shared?: boolean;
  // 原始内层 HTML（导出时参考结构，不在显示用）
  innerHtml?: string;
  // 在原始 HTML 中的字符区间（导出剥离用，闭区间）
  byteRange?: { start: number; end: number };
}

// config.wt.json 中单个区段的元数据
export interface RegionMeta {
  type: EditableType;
  label?: string;
  default?: string;
  validation?: { maxLength?: number; required?: boolean };
}

// config.wt.json 结构
export interface WTConfig {
  name: string;
  version: string;
  editable?: Record<string, RegionMeta>;
  // 页面自定义排序：页面 POSIX 路径数组（页面管理「上移/下移」持久化于此）
  pageOrder?: string[];
  // 模板市场展示元信息（仅市场模板使用，不影响编辑/导出）
  title?: string;
  description?: string;
  category?: string;
  emoji?: string;
  tags?: string[];
}

// 页面级元信息（<head> 中的 title/description/favicon 与 <html lang>）
export interface PageMeta {
  title: string;
  description: string;
  favicon: string; // favicon 的 href（相对页面目录），空字符串 = 无
  lang: string; // <html lang>，空字符串 = 不设置
}

// 模板来源：市场复制 / 外部导入 / 未知（老模板）
export type TemplateSource = 'market' | 'import' | 'custom';

// 模板元信息
export interface TemplateMeta {
  name: string;
  path: string;
  hasConfig: boolean;
  // 工作区内 HTML 页面数（多文件网站支持）
  pageCount?: number;
  // 模板来源（.wt-origin 标记文件），无标记的老模板为 custom
  source?: TemplateSource;
  // 是否存在可回滚的原件快照（.wt-original/）
  hasSnapshot?: boolean;
}

// 解析结果：全部页面 regions（含 page 字段）+ 页面列表
export interface ParseResult {
  templateName: string;
  pages: string[];
  regions: Region[];
  config: WTConfig | null;
  // 各页面 <head> 元信息（title/description/favicon/lang）
  metaByPage?: Record<string, PageMeta>;
}

// iframe 内节点矩形
export interface RegionRect {
  rid: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
  };
}

// iframe → 父端消息
export type IframeMessage =
  | { type: 'wt-rects'; rects: RegionRect[]; scrollX?: number; scrollY?: number }
  | { type: 'wt-ready' }
  | { type: 'wt-navigate'; href: string }
  | { type: 'wt-select'; rid: string }
  // 回复 wt-match-selectors：matched 为命中的候选选择器索引，suggested 为元素的建议选择器
  | {
      type: 'wt-matched-selectors';
      requestId: string;
      matched: number[];
      suggested?: string;
    };

// 父端 → iframe 消息
export type ParentMessage =
  | {
      type: 'wt-update';
      rid: string;
      updateType: 'text' | 'html' | 'attr' | 'src' | 'style';
      value: string;
      attrName?: string;
      prop?: string; // style 更新时的 CSS 属性名
    }
  | {
      // custom-css：一次设置/清除多个 CSS 属性
      type: 'wt-update';
      rid: string;
      updateType: 'styles';
      styles: Record<string, string>;
    }
  | {
      // link：同时更新 href 与链接文字
      type: 'wt-update';
      rid: string;
      updateType: 'link';
      href: string;
      text: string;
    }
  | {
      // image：同时更新 src 与 alt 替代文字
      type: 'wt-update';
      rid: string;
      updateType: 'image';
      src: string;
      alt: string;
    }
  | {
      // CSS 可视化编辑：整表覆盖预览（iframe 内写入 <style id="wt-custom-css">）
      type: 'wt-css-update';
      cssText: string;
    }
  | {
      // 选中 CSS 规则时高亮页面中匹配该选择器的元素（selector 为空 = 清除高亮）
      type: 'wt-css-highlight';
      selector: string;
    }
  | {
      // 全站自定义代码：把 head/body 代码注入预览（script 以可执行方式插入）
      type: 'wt-inject-update';
      head: string;
      body: string;
    }
  | {
      // 点击页面组件后：询问 iframe 该元素匹配哪些候选选择器
      type: 'wt-match-selectors';
      requestId: string;
      rid: string;
      selectors: string[];
    }
  | { type: 'wt-request-rects' };
