// shared/template-url.ts
// iframe 加载 wt-template:// 协议的 URL 构造。
// 模板名可能是中文（如「怕个2」）、页面路径可能含子目录与空格，
// 必须逐段 percent-encode，否则 Chromium 解析 non-special scheme URL 时会失败导致白屏。
// 协议处理器（template-protocol.ts）用 decodeURIComponent 还原。

export function buildTemplateUrl(template: string, page: string, bust?: number): string {
  const host = encodeURIComponent(template);
  const encodedPath = page
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const query = bust ? `?wt-t=${bust}` : '';
  return `wt-template://${host}/${encodedPath}${query}`;
}

/**
 * 以当前页面路径为基准，把站内 href 解析为模板根的 POSIX 页面路径。
 * 仅处理站内相对路径；外部 URL / mailto / 纯锚点不经过这里。
 * 例：('about/index.html', '../contact/index.html') → 'contact/index.html'
 */
export function resolvePagePath(currentPage: string, href: string): string {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return currentPage;
  // 目录式链接以 / 结尾（about/、/about/、./）是「目录入口 index.html」约定
  const dirIndex = clean.endsWith('/');
  // 绝对路径（以 / 开头）相对于模板根
  const rel = clean.replace(/^\/+/, '');
  const isAbsolute = clean.startsWith('/');
  const pageDir =
    !isAbsolute && currentPage.includes('/')
      ? currentPage.slice(0, currentPage.lastIndexOf('/'))
      : '';
  const base = pageDir ? pageDir.split('/') : [];
  for (const part of rel.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  if (dirIndex) base.push('index.html');
  return base.join('/');
}

/**
 * 在已知页面集合中把 href 解析为实际存在的页面路径；对应不到任何页面时返回 null。
 * 依次尝试：直接解析 → <解析结果>/index.html（无扩展名目录式）→ <解析结果>.html（省扩展名）。
 * 例：('index.html', 'about', ['about/index.html']) → 'about/index.html'
 */
export function resolveKnownPage(
  currentPage: string,
  href: string,
  pages: readonly string[]
): string | null {
  const direct = resolvePagePath(currentPage, href);
  if (pages.includes(direct)) return direct;
  for (const candidate of [`${direct}/index.html`, `${direct}.html`]) {
    if (pages.includes(candidate)) return candidate;
  }
  return null;
}

/**
 * 生成从 fromPage 所在目录到 toPage 的浏览器相对 href（静态导出后同样有效）。
 * 例：('about/index.html', 'contact/index.html') → '../contact/index.html'
 *     ('index.html', 'about/index.html')         → 'about/index.html'
 */
export function relativePageHref(fromPage: string, toPage: string): string {
  const fromDir = fromPage.includes('/') ? fromPage.slice(0, fromPage.lastIndexOf('/')) : '';
  if (!fromDir) return toPage;
  const up = fromDir
    .split('/')
    .map(() => '..')
    .join('/');
  return `${up}/${toPage}`;
}

/**
 * 重写一份 HTML 中所有指向 oldTarget 页面的站内 href，使其指向 newTarget。
 * 用于页面重命名/删除后的全站链接修正；外科手术式正则替换，保留原格式与查询串/锚点。
 * 外部链接、mailto、纯锚点不动；返回新 HTML 字符串（无命中时与入参相同）。
 */
export function rewritePageHrefs(
  html: string,
  currentPage: string,
  oldTarget: string,
  newTarget: string,
  knownPages?: readonly string[]
): string {
  const replaceOne = (rawHref: string): string => {
    // 拆出路径部分与后缀（?query / #anchor），后缀原样保留
    const hashIdx = rawHref.indexOf('#');
    const queryIdx = rawHref.indexOf('?');
    let cut = rawHref.length;
    if (hashIdx >= 0) cut = Math.min(cut, hashIdx);
    if (queryIdx >= 0) cut = Math.min(cut, queryIdx);
    const clean = rawHref.slice(0, cut);
    const suffix = rawHref.slice(cut);
    if (!clean) return rawHref;
    // 仅处理站内相对/根相对路径
    if (/^(https?:)?\/\//.test(clean) || clean.startsWith('data:') || clean.startsWith('mailto:') || clean.startsWith('tel:')) {
      return rawHref;
    }
    const resolved = knownPages
      ? resolveKnownPage(currentPage, clean, knownPages)
      : resolvePagePath(currentPage, clean);
    if (resolved !== oldTarget) return rawHref;
    return relativePageHref(currentPage, newTarget) + suffix;
  };

  return html.replace(
    /(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi,
    (full, prefix: string, dq: string | undefined, sq: string | undefined) => {
      const raw = dq ?? sq ?? '';
      const next = replaceOne(raw);
      if (next === raw) return full;
      const quote = dq !== undefined ? '"' : "'";
      return `${prefix}${quote}${next}${quote}`;
    }
  );
}
