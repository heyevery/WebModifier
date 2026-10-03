// shared/region-message.ts
// 根据 region 类型与目标值，构造发给 iframe 的实时更新消息
// PropertyPanel（正向编辑）与 store（撤销/重做/历史跳转）共用

import type { ParentMessage, Region } from './types/region';
import { buildLiHtml } from './element-utils';

function safeJsonParse<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function buildRegionUpdateMessage(region: Region, value: string): ParentMessage {
  const rid = region.anchorRids[0];
  switch (region.type) {
    case 'image': {
      // 新格式 JSON { src, alt }；兼容旧格式纯字符串（仅 src）
      const parsed = safeJsonParse<{ src?: string; alt?: string } | null>(value, null);
      const src = parsed && typeof parsed === 'object' && typeof parsed.src === 'string' ? parsed.src : value;
      const alt = parsed && typeof parsed === 'object' && typeof parsed.alt === 'string' ? parsed.alt : '';
      return { type: 'wt-update', rid, updateType: 'image', src, alt };
    }
    case 'link': {
      // 新格式 JSON { href, text }；兼容旧格式纯字符串（仅 href）
      const parsed = safeJsonParse<{ href?: string; text?: string } | null>(value, null);
      const href = parsed && typeof parsed === 'object' && typeof parsed.href === 'string' ? parsed.href : value;
      const text = parsed && typeof parsed === 'object' && typeof parsed.text === 'string' ? parsed.text : '';
      return { type: 'wt-update', rid, updateType: 'link', href, text };
    }
    case 'color': {
      // 新格式为 JSON { prop, value }；兼容旧格式纯颜色字符串
      const parsed = safeJsonParse<{ prop?: string; value?: string } | null>(value, null);
      const prop =
        parsed && typeof parsed === 'object' && parsed.prop ? parsed.prop : region.prop || 'color';
      const colorValue =
        parsed && typeof parsed === 'object' && typeof parsed.value === 'string'
          ? parsed.value
          : value;
      return { type: 'wt-update', rid, updateType: 'style', value: colorValue, prop };
    }
    case 'custom-css': {
      // 值为 JSON { prop: value, ... } → 批量样式更新
      const styles = safeJsonParse<Record<string, string>>(value, {});
      return { type: 'wt-update', rid, updateType: 'styles', styles };
    }
    case 'richtext':
    case 'html':
      return { type: 'wt-update', rid, updateType: 'html', value };
    case 'list':
      return { type: 'wt-update', rid, updateType: 'html', value: buildLiHtml(value) };
    case 'video': {
      const v = safeJsonParse(value, { src: '', poster: '', controls: true });
      return { type: 'wt-update', rid, updateType: 'src', value: v.src };
    }
    case 'audio': {
      const v = safeJsonParse(value, { src: '', controls: true });
      return { type: 'wt-update', rid, updateType: 'src', value: v.src };
    }
    case 'divider': {
      const v = safeJsonParse(value, { style: '', color: '' });
      return { type: 'wt-update', rid, updateType: 'style', value: v.color, prop: 'border-color' };
    }
    case 'spacer':
      return { type: 'wt-update', rid, updateType: 'style', value, prop: 'height' };
    case 'input': {
      const v = safeJsonParse(value, { type: 'text', placeholder: '', value: '' });
      return { type: 'wt-update', rid, updateType: 'attr', attrName: 'value', value: v.value };
    }
    case 'textarea': {
      const v = safeJsonParse(value, { placeholder: '', value: '' });
      return { type: 'wt-update', rid, updateType: 'text', value: v.value };
    }
    case 'checkbox': {
      const v = safeJsonParse(value, { checked: false, label: '' });
      return {
        type: 'wt-update',
        rid,
        updateType: 'attr',
        attrName: 'checked',
        value: v.checked ? 'checked' : ''
      };
    }
    case 'select': {
      const v = safeJsonParse(value, {
        options: [] as { label: string; value: string }[],
        value: ''
      });
      const optionsHtml = (v.options || [])
        .map(
          (o: { label: string; value: string }) =>
            `<option value="${o.value}"${o.value === v.value ? ' selected' : ''}>${o.label}</option>`
        )
        .join('');
      return { type: 'wt-update', rid, updateType: 'html', value: optionsHtml };
    }
    default:
      return { type: 'wt-update', rid, updateType: 'text', value };
  }
}
