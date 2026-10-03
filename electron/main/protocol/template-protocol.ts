// electron/main/protocol/template-protocol.ts
// wt-template:// 自定义协议
// 替代 iframe srcdoc，解决相对资产路径与同源问题

import { protocol } from 'electron';
import { domainToUnicode } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { INJECT_SCRIPT } from '@shared/inject-script';
import { LruMap } from '@shared/lru';
import { getTemplatesDir } from '../services/app-paths';

const TEMPLATES_DIR = getTemplatesDir();

// 内存中缓存：模板名/页面路径 → 已注入 rid 的 displayHtml。
// 有界 LRU：长期跨模板打开不再无限累积；淘汰时保护「当前写入模板」的页面，
// 否则 iframe 会回退到磁盘原始 HTML（无 data-wt-rid），选中/框选会失效。
const MAX_DISPLAY_HTML_PAGES = 200;
const displayHtmlMap = new LruMap<string, string>(MAX_DISPLAY_HTML_PAGES);

function displayHtmlKey(templateName: string, page: string): string {
  return `${templateName}/${page}`;
}

export function setDisplayHtml(templateName: string, page: string, html: string): void {
  const key = displayHtmlKey(templateName, page);
  displayHtmlMap.set(key, html, (candidate) => !candidate.startsWith(`${templateName}/`));
}

export function getDisplayHtml(templateName: string, page: string): string | undefined {
  return displayHtmlMap.get(displayHtmlKey(templateName, page));
}

// 把 iframe 注入脚本嵌入到 displayHtml 的 </body> 之前
function withInjectScript(html: string): string {
  if (html.includes('id="wt-inject-script"')) return html;
  if (html.includes('</body>')) {
    return html.replace('</body>', `<script id="wt-inject-script">${INJECT_SCRIPT}</script></body>`);
  }
  // 没有 </body>，附加到末尾
  return html + `<script id="wt-inject-script">${INJECT_SCRIPT}</script>`;
}

export function clearDisplayHtml(templateName?: string): void {
  if (templateName) {
    displayHtmlMap.deleteWhere((key) => key.startsWith(`${templateName}/`));
  } else {
    displayHtmlMap.clear();
  }
}

export function registerTemplateProtocol(): void {
  protocol.handle('wt-template', async (request) => {
    try {
      const url = new URL(request.url);
      // standard 协议：wt-template://<模板名>/<文件路径>
      // host 是模板名，pathname 是模板内相对路径
      // 注意：注册为 standard 后，Chromium 会对非 ASCII host 做 IDNA 规范化
      // （中文模板名 → xn-- punycode），必须 domainToUnicode 还原；
      // 同时兼容 percent-encoded host；纯英文名两层处理均原样返回。
      const templateName = domainToUnicode(decodeURIComponent(url.hostname));
      if (!templateName) {
        return new Response('Bad Request: missing template name', { status: 400 });
      }
      const restRaw = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      // 根路径默认 index.html
      const restPath = restRaw === '' ? 'index.html' : restRaw;

      // 路径逃逸检查
      const filePath = path.join(TEMPLATES_DIR, templateName, restPath);
      const resolved = path.resolve(filePath);
      const templatesRoot = path.resolve(TEMPLATES_DIR);
      if (!resolved.startsWith(templatesRoot + path.sep) && resolved !== templatesRoot) {
        return new Response('Forbidden', { status: 403 });
      }

      // 任意页面命中缓存（已注入 rid 的 displayHtml）→ 注入脚本后返回；
      // 走 getDisplayHtml 以顺带刷新 LRU 热度
      if (restPath.endsWith('.html') || restPath.endsWith('.htm')) {
        const cached = getDisplayHtml(templateName, restPath);
        if (cached) {
          const html = withInjectScript(cached);
          return new Response(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
      }

      // 否则从 templates/<name>/<rest> 读文件
      try {
        const content = await fs.promises.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = getMimeType(ext);
        return new Response(content, {
          status: 200,
          headers: { 'Content-Type': mimeType }
        });
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
  });
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.ico': 'image/x-icon'
  };
  return map[ext] || 'application/octet-stream';
}
