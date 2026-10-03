import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { resolve } from 'path';

const sharedAlias = {
  '@': resolve(__dirname, 'src'),
  '@shared': resolve(__dirname, 'shared')
};

// ---- 渲染层 Content-Security-Policy ----
// 仅作用于应用壳文档；编辑器 iframe（wt-template://）是独立文档，用户模板不受限制。
// - script-src 'self'：无内联脚本/eval；Vite dev 的 @vite/client 与依赖预构建均同源
// - style-src 'unsafe-inline'：framer-motion 依赖内联 style 属性，dev 下 Vite 注入 <style>
// - img-src：区域缩略图可能是 data: / http(s) 外链 / wt-template: 协议
// - frame-src wt-template:：只允许嵌入模板预览 iframe
// dev 额外放行 ws:（HMR，端口可能因占用漂移，用 scheme-source 覆盖）
// React Refresh 预导言是 @vitejs/plugin-react 注入的固定内联 module（仅 dev），
// 用 sha256 精确放行，不开放 'unsafe-inline'；升级该插件后若 dev 白屏需重算此 hash
const REACT_REFRESH_PREAMPLE_HASH = "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='";
const CSP_DEV = [
  "default-src 'self'",
  `script-src 'self' ${REACT_REFRESH_PREAMPLE_HASH}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: http: https: wt-template:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  'frame-src wt-template:',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: http: https: wt-template:",
  "font-src 'self' data:",
  "connect-src 'self'",
  'frame-src wt-template:',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

/** 把环境对应的 CSP meta 注入 index.html（dev serve 与 build 产物各自一份） */
function cspPlugin(): Plugin {
  return {
    name: 'wt-inject-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const csp = ctx.server ? CSP_DEV : CSP_PROD;
        const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
        if (html.includes('http-equiv="Content-Security-Policy"')) return html;
        return html.replace(/<\/title>/i, `</title>\n    ${meta}`);
      }
    }
  };
}

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    }
  },
  preload: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src',
    resolve: { alias: sharedAlias },
    plugins: [react(), cspPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') },
        output: {
          // 框架依赖独立分包：体积大、变动少，便于浏览器缓存；
          // 功能面板/对话框再由 React.lazy 按使用时机切分
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'motion-vendor': ['framer-motion']
          }
        }
      }
    }
  }
});
