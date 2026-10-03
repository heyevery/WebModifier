// shared/inject-script.ts
// 注入到 iframe 内的脚本：广播节点矩形 + 接收父端更新指令
// 使用 ES5 语法以确保最大兼容性
// 严格不引用外部模块，作为字符串内联到 iframe HTML

export const INJECT_SCRIPT = `
(function() {
  function broadcastRects() {
    var els = document.querySelectorAll('[data-wt-rid]');
    var rects = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rects.push({
        rid: el.getAttribute('data-wt-rid'),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left }
      });
    }
    // 附带滚动偏移：父端跨域无法直接读 iframe 的 scrollX/scrollY
    parent.postMessage({
      type: 'wt-rects',
      rects: rects,
      scrollX: window.scrollX || window.pageXOffset || 0,
      scrollY: window.scrollY || window.pageYOffset || 0
    }, '*');
  }

  window.addEventListener('load', function() {
    broadcastRects();
    parent.postMessage({ type: 'wt-ready' }, '*');
  });

  // 全站自定义代码注入：先移除上一轮注入节点，再解析新代码逐个插入。
  // script 必须手动 createElement 才会执行；meta/link/style/div 等元素直接搬运。
  function applySiteInjection(where, code) {
    var oldList = document.querySelectorAll('[data-wt-inject="' + where + '"]');
    for (var oi = 0; oi < oldList.length; oi++) {
      var oldEl = oldList[oi];
      if (oldEl.parentNode) oldEl.parentNode.removeChild(oldEl);
    }
    if (!code) return;
    var holder = document.createElement('div');
    holder.innerHTML = code;
    var root = where === 'head'
      ? (document.head || document.documentElement)
      : (document.body || document.documentElement);
    while (holder.firstChild) {
      var node = holder.firstChild;
      var injected = null;
      if (node.nodeType === 1) {
        if (node.tagName === 'SCRIPT') {
          injected = document.createElement('script');
          for (var ai = 0; ai < node.attributes.length; ai++) {
            injected.setAttribute(node.attributes[ai].name, node.attributes[ai].value);
          }
          injected.text = node.textContent || '';
        } else {
          injected = node.cloneNode(true);
        }
      }
      holder.removeChild(node);
      if (injected) {
        injected.setAttribute('data-wt-inject', where);
        root.appendChild(injected);
      }
    }
  }

  window.addEventListener('scroll', broadcastRects, true);
  window.addEventListener('resize', broadcastRects);

  if (typeof ResizeObserver !== 'undefined') {
    var ro = new ResizeObserver(function() { broadcastRects(); });
    if (document.documentElement) ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
  }

  if (typeof MutationObserver !== 'undefined' && document.body) {
    var mo = new MutationObserver(function() { broadcastRects(); });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'wt-update' && msg.rid) {
      var el = document.querySelector('[data-wt-rid="' + msg.rid + '"]');
      if (!el) return;
      if (msg.updateType === 'text') {
        el.textContent = msg.value;
      } else if (msg.updateType === 'html') {
        el.innerHTML = msg.value;
      } else if (msg.updateType === 'attr' && msg.attrName) {
        if (msg.value === '') {
          el.removeAttribute(msg.attrName);
        } else {
          el.setAttribute(msg.attrName, msg.value);
        }
      } else if (msg.updateType === 'src') {
        el.setAttribute('src', msg.value);
      } else if (msg.updateType === 'style' && msg.prop) {
        el.style.setProperty(msg.prop, msg.value);
      } else if (msg.updateType === 'link') {
        // 链接：href 属性 + 链接文字同时更新
        if (msg.href === '') {
          el.removeAttribute('href');
        } else {
          el.setAttribute('href', msg.href);
        }
        el.textContent = msg.text || '';
      } else if (msg.updateType === 'image') {
        // 图片：src + alt 同时更新
        el.setAttribute('src', msg.src || '');
        if (msg.alt === '') {
          el.removeAttribute('alt');
        } else {
          el.setAttribute('alt', msg.alt);
        }
      } else if (msg.updateType === 'styles' && msg.styles) {
        // custom-css：region 拥有该元素全部内联样式，整体重建
        el.removeAttribute('style');
        for (var key in msg.styles) {
          if (!Object.prototype.hasOwnProperty.call(msg.styles, key)) continue;
          if (!key || msg.styles[key] === '') continue;
          el.style.setProperty(key, msg.styles[key]);
        }
      }
      setTimeout(broadcastRects, 0);
    } else if (msg.type === 'wt-css-update') {
      // CSS 可视化编辑：整表覆盖到 <style id="wt-custom-css">
      var cssEl = document.getElementById('wt-custom-css');
      if (!cssEl) {
        cssEl = document.createElement('style');
        cssEl.id = 'wt-custom-css';
        (document.head || document.documentElement).appendChild(cssEl);
      }
      cssEl.textContent = msg.cssText || '';
    } else if (msg.type === 'wt-inject-update') {
      // 全站自定义代码：重建 head/body 注入（innerHTML 插入的 <script> 不会执行，
      // 必须手动创建 script 元素并搬运属性与代码）
      applySiteInjection('head', msg.head || '');
      applySiteInjection('body', msg.body || '');
    } else if (msg.type === 'wt-css-highlight') {
      // 选中 CSS 规则时高亮匹配元素：先清除旧高亮，再给新元素加 outline
      var hlOld = document.querySelectorAll('[data-wt-hl]');
      for (var hi = 0; hi < hlOld.length; hi++) {
        var hlEl = hlOld[hi];
        hlEl.style.outline = hlEl.getAttribute('data-wt-hl-old') || '';
        hlEl.style.outlineOffset = hlEl.getAttribute('data-wt-hl-old-offset') || '';
        hlEl.removeAttribute('data-wt-hl');
        hlEl.removeAttribute('data-wt-hl-old');
        hlEl.removeAttribute('data-wt-hl-old-offset');
      }
      if (msg.selector) {
        var hlNodes;
        try {
          hlNodes = document.querySelectorAll(msg.selector);
        } catch (err) {
          hlNodes = [];
        }
        for (var hj = 0; hj < hlNodes.length; hj++) {
          var target = hlNodes[hj];
          target.setAttribute('data-wt-hl-old', target.style.outline || '');
          target.setAttribute('data-wt-hl-old-offset', target.style.outlineOffset || '');
          target.style.outline = '2px solid rgba(99,102,241,0.85)';
          target.style.outlineOffset = '1px';
          target.setAttribute('data-wt-hl', '1');
        }
      }
    } else if (msg.type === 'wt-match-selectors') {
      // 点击组件后：用原生 matches() 判断该元素命中哪些候选选择器
      var matchEl = document.querySelector('[data-wt-rid="' + msg.rid + '"]');
      var matchedIdx = [];
      var suggested = '';
      if (matchEl) {
        for (var mi = 0; mi < msg.selectors.length; mi++) {
          try {
            if (matchEl.matches(msg.selectors[mi])) matchedIdx.push(mi);
          } catch (err2) {}
        }
        // 生成建议选择器：合法 #id → 第一个非 wt- 的 class → 标签名
        // 不使用正则字面量（模板字符串构建时转义可能被压缩破坏）
        var idVal = matchEl.id || '';
        var idOk = idVal.length > 0;
        if (idOk) {
          var ch0 = idVal.charAt(0);
          var isLetter = (ch0 >= 'a' && ch0 <= 'z') || (ch0 >= 'A' && ch0 <= 'Z');
          if (!isLetter) idOk = false;
          for (var kk = 1; kk < idVal.length && idOk; kk++) {
            var ch = idVal.charAt(kk);
            var okCh = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                       (ch >= '0' && ch <= '9') || ch === '_' || ch === '-';
            if (!okCh) idOk = false;
          }
        }
        if (idOk) {
          suggested = '#' + idVal;
        } else if (matchEl.classList && matchEl.classList.length) {
          for (var ci = 0; ci < matchEl.classList.length; ci++) {
            var cls = matchEl.classList[ci];
            if (cls.indexOf('wt-') !== 0) { suggested = '.' + cls; break; }
          }
        }
        if (!suggested) suggested = matchEl.tagName ? matchEl.tagName.toLowerCase() : '';
      }
      parent.postMessage({
        type: 'wt-matched-selectors',
        requestId: msg.requestId,
        matched: matchedIdx,
        suggested: suggested
      }, '*');
    } else if (msg.type === 'wt-request-rects') {
      broadcastRects();
    }
  });

  // 拦截页面内链接点击：相对路径 HTML → 通知父端切换页面；外部链接保持默认
  function interceptLinks() {
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      (function(a) {
        a.addEventListener('click', function(e) {
          var href = a.getAttribute('href');
          if (!href) return;
          // 跳过锚点、mailto、javascript、远程链接
          // 注意：不能在正则字面量中使用 \/ （esbuild 会把模板字符串中的 \/ 压缩为 /，
          // 注入到 <script> 后会导致正则提前闭合、整段脚本语法错误）
          if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//') || href.startsWith('mailto:') || href.startsWith('javascript:') || href.startsWith('#')) {
            return;
          }
          // 只处理指向本地 HTML 的相对链接
          // 不使用正则字面量：esbuild 会把模板字符串中的 \. \/ 等转义吞掉，
          // 注入到 <script> 后正则语义被破坏
          var hrefPath = href.split('#')[0].split('?')[0].toLowerCase();
          var isHtmlLink =
            hrefPath.length >= 5 &&
            (hrefPath.lastIndexOf('.html') === hrefPath.length - 5 ||
              hrefPath.lastIndexOf('.htm') === hrefPath.length - 4);
          if (isHtmlLink) {
            e.preventDefault();
            parent.postMessage({ type: 'wt-navigate', href: href }, '*');
          }
        });
      })(links[i]);
    }
  }

  // 点击选中：点击带 data-wt-rid 的元素（或其子元素）→ 通知父端选中该区段
  // capture 阶段执行，优先于链接拦截；链接型区段点击时选中而非跳转
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.getAttribute) {
      var rid = el.getAttribute('data-wt-rid');
      if (rid) {
        e.preventDefault();
        e.stopPropagation();
        parent.postMessage({ type: 'wt-select', rid: rid }, '*');
        return;
      }
      el = el.parentNode;
    }
  }, true);

  window.addEventListener('load', function() {
    interceptLinks();
  });

  // 动态新增的链接也需拦截
  if (typeof MutationObserver !== 'undefined') {
    var linkObserver = new MutationObserver(function() { interceptLinks(); });
    if (document.body) linkObserver.observe(document.body, { childList: true, subtree: true });
  }
})();
`;
