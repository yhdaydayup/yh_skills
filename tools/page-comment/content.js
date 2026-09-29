/* 页面批注 —— 内容脚本
 *
 * 目标不是「能写评论」，而是让导出的每条评论都能被接收方直接定位回源码：
 * 所以每条批注都同时记录 章节路径 / CSS 选择器 / 选中原文 三种线索，
 * 任何一种失效时其余两种仍可用来找回位置。
 */
(() => {
  if (window.__pageCommentLoaded) return;
  window.__pageCommentLoaded = true;

  const NS = 'pc';
  const MAX_QUOTE = 120;    // 面板/导出里展示的原文长度
  const MATCH_LEN = 300;    // 用于回找定位的原文长度，比展示长，够唯一即可
  const CTX = 40;           // 记录锚点前后各多少字，用于重复文字的消歧

  /** 公共后缀长度 / 公共前缀长度 */
  const tailLen = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; };
  const headLen = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

  /* ── 存储：扩展内用 chrome.storage，直接注入调试时退回 localStorage ──
   *
   * key 每次取用时重算，不能在启动时算死：SPA 用 pushState 换路由不会重新注入脚本，
   * key 固定住的话，新路由下写的批注会存进进入时那个路径里去。
   * hash 路由（#/foo）算不同页面，普通锚点（#s1）不算 —— 否则同一篇报告
   * 跳一次目录就各存一份。
   */
  const hasExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const pageId = () => location.origin + location.pathname +
    (location.hash.startsWith('#/') ? location.hash : '');
  const key = () => 'pc:' + pageId();

  const store = {
    async get() {
      const k = key();
      if (hasExt) return (await chrome.storage.local.get(k))[k] || [];
      try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; }
    },
    async set(v) {
      const k = key();
      if (hasExt) return chrome.storage.local.set({ [k]: v });
      localStorage.setItem(k, JSON.stringify(v));
    },
  };

  let items = [];
  let mode = null;          // null | 'element'
  let panelOpen = false;
  let pending = null;       // 正在编辑的定位信息

  /* ══════════════ 定位器 ══════════════ */

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const tight = (s) => (s || '').replace(/\s+/g, '');

  /* ── 文本锚点 ──
   * 选区一旦跨过标签边界（正文里 <b> 很密），commonAncestorContainer 就退化成
   * 整个父容器，用它定位等于把「一句话」记成「一大段」。
   * 所以文字批注完全不靠元素：把全文可见文本拉平成一个去空白的字符串，
   * 选区记成这个字符串上的字符区间 + 第几次出现，回显时还原成精确的 Range。
   */
  let _flat = null, _cache = new WeakMap();
  const invalidate = () => { _flat = null; _cache = new WeakMap(); };

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SLOT']);

  /* TreeWalker 不跨 shadow 边界，用 Web Component 搭的站点会整片取不到文字。
     这里手写遍历，遇到开放 shadow root 就钻进去；<slot> 跳过，它的内容已经在
     light DOM 里走过一遍了，否则会重复计数。 */
  function collect(root, out) {
    for (const n of root.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) out.push(n); continue; }
      if (n.nodeType !== 1 || n === host || SKIP.has(n.tagName)) continue;
      if (n.shadowRoot) collect(n.shadowRoot, out);
      collect(n, out);
    }
  }

  function flat() {
    if (_flat) return _flat;
    const nodes = [];
    collect(document.body, nodes);
    let s = '';
    const idx = [];                       // idx[2k]=文本节点, idx[2k+1]=节点内偏移
    for (const n of nodes) {
      const v = n.nodeValue;
      for (let i = 0; i < v.length; i++) {
        if (/\s/.test(v[i])) continue;
        idx.push(n, i);
        s += v[i];
      }
    }
    return (_flat = { s, idx });
  }

  function rangeAt(start, len) {
    const { idx } = flat();
    if (start < 0 || len < 1 || (start + len) * 2 > idx.length) return null;
    const r = document.createRange();
    r.setStart(idx[start * 2], idx[start * 2 + 1]);
    r.setEnd(idx[(start + len - 1) * 2], idx[(start + len - 1) * 2 + 1] + 1);
    return r;
  }

  /** 选区起点在扁平文本里的下标，用来区分同一段文字的第几次出现 */
  function tightStart(range) {
    const { idx } = flat();
    const n = range.startContainer, o = range.startOffset;
    if (n.nodeType !== 3) return -1;
    for (let k = 0; k * 2 < idx.length; k++) {
      if (idx[k * 2] === n && idx[k * 2 + 1] >= o) return k;
    }
    return -1;
  }

  /** 标题正文：副标题通常是塞在标题里的块级子元素（本站是 <span class="lead">），不算标题本身 */
  function headText(h) {
    const drop = new Set();
    [...h.children].forEach((c, i) => {
      try { if (getComputedStyle(c).display === 'block') drop.add(i); } catch { /* 忽略 */ }
    });
    const c = h.cloneNode(true);
    [...c.children].forEach((k, i) => { if (drop.has(i)) k.remove(); });
    return norm(c.textContent).slice(0, 44);
  }

  /** 面包屑：元素所属的 h2 与 h3，组合成「一、投资结论 › 1.1 一图看全貌」 */
  function sectionOf(el) {
    const pick = (sel) => {
      let best = null;
      for (const h of document.querySelectorAll(sel)) {
        if (h === el) { best = h; continue; }                       // 元素本身就是标题
        if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
      }
      return best;
    };
    const top = pick('h1,h2'), sub = pick('h3,h4');
    const out = [];
    if (top) out.push({ text: headText(top), id: top.id || '' });
    // h3 只有落在 h2 之后才是它的子节，否则是上一节残留下来的
    if (sub && (!top || (top.compareDocumentPosition(sub) & Node.DOCUMENT_POSITION_FOLLOWING))) {
      out.push({ text: headText(sub), id: sub.id || '' });
    }
    return out;
  }

  /** 短 CSS 路径：向上找到第一个带 id 的祖先就停，避免又长又脆的全路径 */
  function cssPath(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let s = n.tagName.toLowerCase();
      const p = n.parentElement;
      if (p) {
        const sibs = [...p.children].filter((c) => c.tagName === n.tagName);
        if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      }
      parts.unshift(s);
      if (n === document.body) break;
    }
    return parts.join(' > ');
  }

  /** 给人看的元素名。图表优先报 canvas id —— 那是源码里唯一的抓手；
   *  普通元素不用长路径，报「标签.类名 @ 所属区块」，精确定位交给原文。 */
  function label(el) {
    if (el.tagName === 'CANVAS' && el.id) return `canvas#${el.id}`;
    const cv = el.closest && el.closest('canvas');
    if (cv && cv.id) return `canvas#${cv.id}`;
    if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`;
    let s = el.tagName.toLowerCase();
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/)[0];
    if (cls) s += '.' + cls;
    const sec = (sectionOf(el)[0] || {}).id;
    return sec ? `${s} @ #${sec}` : s;
  }

  /* 元素指纹。结构一变 nth-of-type 路径就断，而图片、图标这类又没有文字可供兜底检索，
     所以额外记下身份属性；src 可能是很长的 data URL，截断后仍足够区分。 */
  const ID_ATTRS = ['alt', 'aria-label', 'title', 'name'];

  function fingerprint(el) {
    const g = (k) => (el.getAttribute ? el.getAttribute(k) : null);
    const fp = { tag: el.tagName };
    const src = g('src') || g('href') || g('xlink:href');
    if (src) fp.src = src.slice(0, 160);
    for (const k of ID_ATTRS) { const v = g(k); if (v) fp[k] = v; }
    const cls = (g('class') || '').trim();
    if (cls) fp.cls = cls;
    return fp;
  }

  function fpScore(el, fp) {
    if (!el || !fp || el.tagName !== fp.tag) return 0;
    const g = (k) => el.getAttribute(k);
    let s = 0;
    if (fp.src && (g('src') || g('href') || g('xlink:href') || '').slice(0, 160) === fp.src) s += 3;
    for (const k of ID_ATTRS) if (fp[k] && g(k) === fp[k]) s += 2;
    if (fp.cls && (g('class') || '').trim() === fp.cls) s += 1;
    return s;
  }

  function byFingerprint(fp) {
    if (!fp || !fp.tag) return null;
    let best = null, bs = 0;
    for (const el of document.getElementsByTagName(fp.tag)) {
      const s = fpScore(el, fp);
      if (s > bs) { bs = s; best = el; }
    }
    return bs >= 2 ? best : null;     // 只有 class 对得上太弱，不认
  }

  function makeLocator(el, quote) {
    return {
      kind: 'el',
      section: sectionOf(el),
      selector: cssPath(el),
      attrs: fingerprint(el),
      label: label(el),
      quote: norm(quote).slice(0, MAX_QUOTE),
      tag: el.tagName.toLowerCase(),
    };
  }

  /** 文字选区的定位信息：主键是字符区间，元素路径只作最后兜底 */
  function makeTextLocator(range, raw) {
    const q = tight(raw).slice(0, MATCH_LEN);
    const { s } = flat();
    const start = tightStart(range);
    let occ = 0;
    if (start >= 0 && q) {
      for (let p = s.indexOf(q); p >= 0 && p < start; p = s.indexOf(q, p + 1)) occ++;
    }
    const el = range.startContainer.parentElement || document.body;
    const sec = sectionOf(el);
    return {
      kind: 'text', q, occ,
      // 前后文：同样的文字在页面出现多次时用来挑出原来那一处。
      // 只记「第几次出现」不够 —— 页面前面新插入一段相同文字，计数就整体后移，
      // 锚点会被悄悄抢走，这比失锚更难发现。
      pre: start >= 0 ? s.slice(Math.max(0, start - CTX), start) : '',
      post: start >= 0 ? s.slice(start + q.length, start + q.length + CTX) : '',
      at: start,
      quote: norm(raw).slice(0, MAX_QUOTE),
      section: sec,
      selector: cssPath(el),
      label: '正文文本' + (sec[0] && sec[0].id ? ' @ #' + sec[0].id : ''),
    };
  }

  /** 按原文找回元素：取包含该文本的最深节点，避免命中整个 body */
  function findByQuote(q) {
    const t = tight(q);
    if (t.length < 4) return null;
    let best = null;
    for (const el of document.querySelectorAll('p,div,td,th,li,span,b,i,a,h1,h2,h3,h4,summary,code')) {
      if (tight(el.textContent).includes(t) && (!best || best.contains(el))) best = el;
    }
    return best;
  }

  /** 还原成 Range（文字批注）或 Element（元素批注）—— 两者都支持 getBoundingClientRect / getClientRects */
  function resolve(loc) {
    if (loc.kind === 'text') {
      if (!loc.q) return null;
      const { s } = flat();
      const hits = [];
      for (let p = s.indexOf(loc.q); p >= 0; p = s.indexOf(loc.q, p + 1)) hits.push(p);
      if (!hits.length) return null;
      if (hits.length === 1) return rangeAt(hits[0], loc.q.length);
      if (loc.pre == null && loc.post == null) {
        // 旧版数据只有「第几次出现」，出现次数变少时停在最后一处
        return rangeAt(hits[Math.min(loc.occ || 0, hits.length - 1)], loc.q.length);
      }
      let pick = hits[0], best = -1;
      for (const p of hits) {
        const sc = tailLen(loc.pre || '', s.slice(Math.max(0, p - CTX), p))
                 + headLen(loc.post || '', s.slice(p + loc.q.length, p + loc.q.length + CTX))
                 // 前后文也一样时，取离原始位置最近的那处
                 - (loc.at == null ? 0 : Math.abs(p - loc.at) / 1e6);
        if (sc > best) { best = sc; pick = p; }
      }
      return rangeAt(pick, loc.q.length);
    }
    let bySel = null;
    try { if (loc.selector) bySel = document.querySelector(loc.selector); } catch { /* 选择器可能已失效 */ }
    const fp = byFingerprint(loc.attrs);
    // 结构变动后 nth-of-type 路径可能指到另一个元素上，指纹对得更好就以指纹为准
    if (bySel && (!fp || fp === bySel || fpScore(bySel, loc.attrs) >= fpScore(fp, loc.attrs))) return bySel;
    return fp || findByQuote(loc.quote);
  }

  /** 解析结果缓存：滚动时每帧都要给所有批注算位置，不能每次都重新全文检索 */
  function target(it) {
    if (_cache.has(it)) return _cache.get(it);
    const t = resolve(it.loc);
    _cache.set(it, t);
    return t;
  }

  const rectsOf = (t) => (t ? [...t.getClientRects()].filter((r) => r.width || r.height) : []);

  /* ══════════════ UI ══════════════ */

  const host = document.createElement('div');
  host.id = '__pc_host';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  (document.body || document.documentElement).appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
<style>
  :host{all:initial}
  *{box-sizing:border-box;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .fab{position:fixed;right:18px;bottom:18px;pointer-events:auto;display:flex;align-items:center;gap:7px;
    background:#1f6feb;color:#fff;border:none;border-radius:22px;padding:10px 16px;font-size:13px;
    font-weight:600;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35)}
  .fab:hover{background:#388bfd}
  .fab .n{background:rgba(255,255,255,.25);border-radius:9px;padding:1px 7px;font-size:11.5px}

  .panel{position:fixed;right:18px;bottom:66px;width:360px;max-height:70vh;pointer-events:auto;
    background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:12px;display:none;
    flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden}
  .panel.on{display:flex}
  .ph{display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid #30363d;font-size:13px;font-weight:600}
  .ph .sp{flex:1}
  .pb{overflow:auto;padding:8px;flex:1}
  .pf{display:flex;gap:7px;padding:9px 11px;border-top:1px solid #30363d}

  button.b{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:7px;
    padding:6px 11px;font-size:12px;cursor:pointer}
  button.b:hover{background:#30363d}
  button.b.pri{background:#238636;border-color:#2ea043;color:#fff}
  button.b.pri:hover{background:#2ea043}
  button.b.on{background:#1f6feb;border-color:#388bfd;color:#fff}
  button.b.dim{color:#8b949e}

  .it{border:1px solid #30363d;border-radius:8px;padding:8px 10px;margin-bottom:7px;background:#0d1117}
  .it .top{display:flex;gap:7px;align-items:baseline}
  .it .idx{color:#1f6feb;font-weight:700;font-size:12px;flex-shrink:0}
  .it .sec{color:#8b949e;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .it .loc{color:#d29922;font-size:11px;font-family:ui-monospace,Menlo,monospace;margin:3px 0 0}
  .it .q{color:#8b949e;font-size:11.5px;margin:3px 0 0;border-left:2px solid #30363d;padding-left:6px;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .it .c{font-size:12.5px;margin:5px 0 0;white-space:pre-wrap;word-break:break-word}
  .it .act{display:flex;gap:5px;margin-top:6px}
  .it .act button{background:none;border:none;color:#8b949e;font-size:11px;cursor:pointer;padding:2px 4px}
  .it .act button:hover{color:#e6edf3}
  .it.dead{opacity:.55}
  .it.dead .loc::after{content:' · 页面上已找不到';color:#f85149}

  .empty{color:#8b949e;font-size:12px;text-align:center;padding:26px 12px;line-height:1.7}

  .bub{position:fixed;pointer-events:auto;background:#1f6feb;color:#fff;border:none;border-radius:6px;
    padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;display:none;box-shadow:0 3px 12px rgba(0,0,0,.4)}
  .bub .k{display:inline-block;margin-left:5px;padding:0 4px;border-radius:3px;
    background:rgba(255,255,255,.22);font-weight:700;font-size:11px;line-height:15px}
  .bub.on{display:block}

  .ed{position:fixed;width:310px;pointer-events:auto;background:#161b22;border:1px solid #388bfd;
    border-radius:10px;padding:10px;display:none;box-shadow:0 8px 30px rgba(0,0,0,.5)}
  .ed.on{display:block}
  .ed .t{color:#8b949e;font-size:11px;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ed textarea{width:100%;height:74px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;
    border-radius:6px;padding:7px;font-size:12.5px;resize:vertical;outline:none}
  .ed textarea:focus{border-color:#388bfd}
  .ed .row{display:flex;gap:6px;margin-top:7px;align-items:center}
  .ed .row .sp{flex:1;color:#8b949e;font-size:10.5px}

  .pin{position:fixed;pointer-events:auto;width:20px;height:20px;border-radius:50%;background:#1f6feb;
    color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;
    cursor:pointer;box-shadow:0 0 0 2px rgba(31,111,235,.3);transition:transform .1s}
  .pin:hover{transform:scale(1.18)}
  .pin.dead{background:#6e7681;box-shadow:none}

  .hl{position:fixed;pointer-events:none;border:2px solid #1f6feb;background:rgba(31,111,235,.12);
    border-radius:3px;display:none}
  .hl.on{display:block}
  .mk{position:fixed;pointer-events:none;background:rgba(31,111,235,.3);border-radius:2px;
    box-shadow:0 0 0 1px rgba(88,166,255,.7) inset}
  .undo{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:none;
    align-items:center;gap:10px;background:#161b22;border:1px solid #30363d;border-radius:8px;
    padding:8px 10px 8px 14px;box-shadow:0 6px 20px rgba(0,0,0,.5);font-size:12.5px}
  .undo.on{display:flex}
  .tip{position:fixed;left:50%;top:14px;transform:translateX(-50%);pointer-events:none;
    background:#1f6feb;color:#fff;padding:7px 15px;border-radius:18px;font-size:12.5px;
    font-weight:600;display:none;box-shadow:0 4px 16px rgba(0,0,0,.4)}
  .tip.on{display:block}
</style>

<div class="hl"></div>
<div class="marks"></div>
<div class="undo"><span class="ut"></span><button class="b pri ub">撤销</button></div>
<div class="tip">元素点选模式 — 点击元素或按 c 添加批注，Esc 退出</div>
<div class="pins"></div>
<button class="bub">＋ 评论 <span class="k">c</span></button>

<div class="ed">
  <div class="t"></div>
  <textarea placeholder="写下你的意见…（Enter 保存，Shift + Enter 换行）"></textarea>
  <div class="row"><span class="sp"></span>
    <button class="b cancel">取消</button><button class="b pri save">保存</button></div>
</div>

<div class="panel">
  <div class="ph"><span>页面批注</span><span class="sp"></span>
    <button class="b elem" title="Alt+Shift+E">◎ 点元素</button>
    <button class="b dim close">✕</button></div>
  <div class="pb"></div>
  <div class="pf">
    <button class="b pri copy" style="flex:1">复制全部反馈</button>
    <button class="b dim clear">清空</button>
  </div>
</div>

<button class="fab">✎ 批注 <span class="n">0</span></button>`;

  const $ = (s) => root.querySelector(s);
  const el = {
    fab: $('.fab'), n: $('.fab .n'), panel: $('.panel'), body: $('.pb'),
    bub: $('.bub'), ed: $('.ed'), edT: $('.ed .t'), ta: $('.ed textarea'),
    pins: $('.pins'), hl: $('.hl'), marks: $('.marks'), tip: $('.tip'), elem: $('.elem'),
    undo: $('.undo'), undoT: $('.undo .ut'), undoB: $('.undo .ub'),
  };

  /* ── 渲染 ── */

  function secText(loc) {
    return (loc.section || []).map((s) => s.text).join(' › ') || '（无标题区域）';
  }

  function render() {
    el.n.textContent = items.length;
    el.body.innerHTML = '';
    if (!items.length) {
      el.body.innerHTML =
        '<div class="empty">还没有批注。<br><br>' +
        '<b>选中页面上的文字</b>会弹出「＋ 评论」<br>' +
        '图表等没有文字的地方，点 <b>◎ 点元素</b> 后直接点它</div>';
    }
    items.forEach((it, i) => {
      const alive = !!target(it);
      const d = document.createElement('div');
      d.className = 'it' + (alive ? '' : ' dead');
      d.innerHTML =
        `<div class="top"><span class="idx">${i + 1}</span><span class="sec"></span></div>` +
        `<div class="loc"></div>` +
        (it.loc.quote ? `<div class="q"></div>` : '') +
        `<div class="c"></div>` +
        `<div class="act"><button data-a="go">定位</button>` +
        `<button data-a="ed">编辑</button><button data-a="del">删除</button></div>`;
      d.querySelector('.sec').textContent = secText(it.loc);
      d.querySelector('.loc').textContent = it.loc.label;
      if (it.loc.quote) d.querySelector('.q').textContent = '「' + it.loc.quote + '」';
      d.querySelector('.c').textContent = it.text;
      d.querySelector('[data-a=go]').onclick = () => jump(i);
      d.querySelector('[data-a=ed]').onclick = () => editExisting(i);
      d.querySelector('[data-a=del]').onclick = () => del(i);
      el.body.appendChild(d);
    });
    placePins();
  }

  const PIN = 20, GAP = 3;

  function placePins() {
    el.pins.innerHTML = '';
    const put = [];
    items.forEach((it, i) => {
      const t = target(it);
      if (!t) return;
      const r = t.getBoundingClientRect();
      if (!r.width && !r.height) return;                        // 折叠块内等不可见情形
      if (r.bottom < -40 || r.top > innerHeight + 40) return;   // 视口外不画
      put.push({
        i, it, t,
        left: Math.max(2, Math.min(innerWidth - 24, r.right - 10)),
        top: Math.max(2, r.top - 8),
      });
    });
    // 同一行、甚至同一个元素上的多条批注会算出一模一样的坐标，后画的把先画的完全盖住，
    // 看起来就是「某一条的标记不见了」。按同列顺序往下顺排，保证每条都露出来。
    put.sort((a, b) => a.top - b.top || a.i - b.i);
    const cols = new Map();
    for (const p of put) {
      const key = Math.round(p.left / (PIN + GAP));
      const prev = cols.get(key);
      if (prev != null && p.top < prev + PIN + GAP) p.top = prev + PIN + GAP;
      cols.set(key, p.top);
    }
    for (const p of put) {
      const d = document.createElement('div');
      d.className = 'pin';
      d.textContent = p.i + 1;
      d.style.left = p.left + 'px';
      d.style.top = p.top + 'px';
      d.title = p.it.text;
      d.onclick = () => { openPanel(); reveal(p.t); flash(p.t); };
      el.pins.appendChild(d);
    }
  }

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; placePins(); drawMarks(); });
  };
  addEventListener('scroll', schedule, { passive: true, capture: true });
  addEventListener('resize', schedule, { passive: true });

  /* SPA 换路由靠 DOM 变化捕捉：history.pushState 是主世界的调用，内容脚本在
     隔离世界里改不到它，popstate 也只在前进后退时触发。而任何路由切换必然重渲染
     内容，所以搭在 MutationObserver 上检测反而最可靠，还不用轮询。 */
  let curPage = pageId();
  function syncRoute() {
    if (pageId() === curPage) return false;
    curPage = pageId();
    closeEditor();
    hideBubble();
    markOn = null;
    invalidate();
    store.get().then((v) => { items = v; render(); });
    return true;
  }
  addEventListener('popstate', syncRoute);
  addEventListener('hashchange', syncRoute);

  /* 页面文本变了（折叠展开、异步渲染）就作废扁平索引，否则 Range 会锚到错位置 */
  let moT = 0;
  new MutationObserver(() => {
    if (moT) return;
    moT = setTimeout(() => {
      moT = 0;
      if (syncRoute()) return;            // 换页了，上面已经重载并重绘
      invalidate();
      if (panelOpen) render(); else placePins();
    }, 400);
  }).observe(document.body, { childList: true, characterData: true, subtree: true });

  /* 同一个页面开了两个标签页时，互相同步，避免后保存的把前一个整份覆盖掉 */
  if (hasExt && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((ch, area) => {
      const k = key();
      if (area !== 'local' || !(k in ch)) return;
      const next = ch[k].newValue || [];
      if (JSON.stringify(next) === JSON.stringify(items)) return;   // 自己刚写的
      items = next;
      render();
    });
  }

  /** 高亮用 getClientRects 逐行画：文字选区跨行时，单个包围盒会糊掉整段 */
  let markT = 0, markOn = null;
  function drawMarks() {
    const box = el.marks;
    box.innerHTML = '';
    if (!markOn) return;
    for (const r of rectsOf(markOn)) {
      const d = document.createElement('div');
      d.className = 'mk';
      d.style.cssText =
        `left:${r.left - 1}px;top:${r.top - 1}px;width:${r.width + 2}px;height:${r.height + 2}px`;
      box.appendChild(d);
    }
  }
  function flash(t) {
    markOn = t;
    drawMarks();
    clearTimeout(markT);
    // 高亮框是 fixed 定位，必须跟着滚动重画 —— 平滑滚动期间画一次就不管，会整体错位
    markT = setTimeout(() => { markOn = null; drawMarks(); }, 2200);
  }

  /* 批注可能落在收起的 <details> 里：文字还在 DOM 中，锚点有效，但没有可见位置，
     直接滚过去是一片空白。定位前先把沿途的折叠块都展开。 */
  function reveal(t) {
    let n = t.startContainer || t;
    if (n.nodeType === 3) n = n.parentElement;
    let opened = false;
    for (let e = n; e; e = e.parentElement) {
      if (e.tagName === 'DETAILS' && !e.open) { e.open = true; opened = true; }
    }
    return opened;
  }

  function jump(i) {
    const t = target(items[i]);
    if (!t) return;
    const go = () => {
      // Range 没有 scrollIntoView，按矩形自己滚，元素和文字走同一条路径
      const r = t.getBoundingClientRect();
      scrollTo({ top: scrollY + r.top - innerHeight / 2, behavior: 'smooth' });
      setTimeout(() => flash(t), 420);
    };
    if (reveal(t)) setTimeout(go, 120); else go();   // 等折叠块展开后的重排
  }

  /* ── 增删改 ── */

  /* 落盘失败必须说出来。原来写失败也照样关编辑框、刷新列表，
     看起来存下了其实没有 —— 这种静默丢失比报错难发现得多。 */
  async function persist(before) {
    try {
      await store.set(items);
      return true;
    } catch (e) {
      items = before;                      // 回滚，别让面板和存储不一致
      render();
      toast('保存失败，已撤回改动：' + (e && e.message ? e.message : e));
      return false;
    }
  }

  async function save(text) {
    if (!pending) return;
    text = (text || '').trim();
    /* 判空收在这一处：保存按钮、Enter、⌘/Ctrl+Enter 三条路径都经过这里，
       分头判会漏。原来是静默 return，用户按了没反应也不知道为什么。 */
    if (!text) { toast('批注内容不能为空'); el.ta.focus(); return; }
    const before = items.slice();
    if (pending.editIndex != null) items[pending.editIndex] = { ...items[pending.editIndex], text };
    else items.push({ loc: pending.loc, text, at: Date.now() });
    if (!await persist(before)) return;
    closeEditor();
    render();
  }

  async function del(i) {
    const before = items.slice();
    const [gone] = items.splice(i, 1);
    if (!await persist(before)) return;
    render();
    offerUndo('已删除 1 条批注', () => { items.splice(i, 0, gone); });
  }

  /** 删除类操作一律给一次撤销的机会，替代拦路的 confirm 弹窗 */
  let undoT = 0;
  function offerUndo(label, restore) {
    el.undoT.textContent = label;
    el.undo.classList.add('on');
    clearTimeout(undoT);
    undoT = setTimeout(() => el.undo.classList.remove('on'), 8000);
    el.undoB.onclick = async () => {
      clearTimeout(undoT);
      el.undo.classList.remove('on');
      const before = items.slice();
      restore();
      if (await persist(before)) render();
    };
  }

  function openEditor(loc, anchorRect, editIndex) {
    pending = { loc, editIndex };
    el.edT.textContent = secText(loc) + ' · ' + loc.label;
    el.ta.value = editIndex != null ? items[editIndex].text : '';
    el.ed.classList.add('on');
    const w = 310, h = 150;
    let l = Math.min(anchorRect.left, innerWidth - w - 12);
    let t = anchorRect.bottom + 8;
    if (t + h > innerHeight) t = Math.max(8, anchorRect.top - h - 8);
    el.ed.style.left = Math.max(8, l) + 'px';
    el.ed.style.top = t + 'px';
    el.ta.focus();
    hideBubble();
  }

  function closeEditor() { el.ed.classList.remove('on'); pending = null; }

  function editExisting(i) {
    const t = target(items[i]);
    if (t) {
      reveal(t);
      const r = t.getBoundingClientRect();
      scrollTo({ top: scrollY + r.top - innerHeight / 2 });
    }
    setTimeout(() => openEditor(items[i].loc,
      (t || document.body).getBoundingClientRect(), i), 80);
  }

  /* ── 选中文字 → 气泡 ── */

  let selRect = null, selLoc = null;
  let hoverEl = null;       // 元素模式下鼠标底下的元素，给 c 键用

  function hideBubble() { el.bub.classList.remove('on'); }

  /* 从**当前**选区现算定位，拿不到就返回 null。
     鼠标和 c 键两条路径都走这里：键盘选区（Shift+方向键）不触发 mouseup，
     c 键要是复用 selLoc 就会拿到上一次的旧定位，批注挂到错的地方。 */
  function selectionLoc() {
    const s = getSelection();
    if (!s || s.isCollapsed || !s.toString().trim()) return null;
    const rng = s.getRangeAt(0);
    if (host.contains(rng.commonAncestorContainer)) return null;   // 选中的是插件自己的界面
    const r = rng.getBoundingClientRect();
    if (!r.width && !r.height) return null;                        // 折叠区里的不可见选区
    return { rect: r, loc: makeTextLocator(rng, s.toString()) };
  }

  document.addEventListener('mouseup', () => {
    if (mode === 'element') return;
    setTimeout(() => {
      const sel = selectionLoc();
      if (!sel) return hideBubble();
      selRect = sel.rect;
      selLoc = sel.loc;
      el.bub.style.left = Math.min(sel.rect.left, innerWidth - 90) + 'px';
      el.bub.style.top = Math.max(4, sel.rect.top - 32) + 'px';
      el.bub.classList.add('on');
    }, 10);
  });

  el.bub.onclick = () => openEditor(selLoc, selRect);

  document.addEventListener('mousedown', (e) => {
    if (host.contains(e.target)) return;
    hideBubble();
  });

  /* ── 元素点选模式 ── */

  function setMode(m) {
    mode = m;
    el.elem.classList.toggle('on', m === 'element');
    el.tip.classList.toggle('on', m === 'element');
    if (m !== 'element') { el.hl.classList.remove('on'); hoverEl = null; }
    document.documentElement.style.cursor = m === 'element' ? 'crosshair' : '';
  }

  document.addEventListener('mousemove', (e) => {
    if (mode !== 'element') return;
    if (host.contains(e.target)) return;
    hoverEl = e.target;
    const r = e.target.getBoundingClientRect();
    el.hl.style.cssText =
      `left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px`;
    el.hl.classList.add('on');
  }, true);

  document.addEventListener('click', (e) => {
    if (mode !== 'element' || host.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.target;
    openEditor(makeLocator(t, norm(t.textContent).slice(0, MAX_QUOTE)), t.getBoundingClientRect());
    setMode(null);
  }, true);

  /* ── 导出 ── */

  function exportText() {
    const title = norm(document.title) || location.pathname.split('/').pop();
    const d = new Date();
    const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const L = [`页面批注 · ${title}`, location.href, `${ts} · 共 ${items.length} 条`, ''];
    items.forEach((it, i) => {
      L.push(`[${i + 1}] ${secText(it.loc)}`);
      L.push(`    位置  ${it.loc.label}`);
      if (it.loc.quote) L.push(`    原文  「${it.loc.quote}」`);
      L.push(`    意见  ${it.text.replace(/\n/g, '\n          ')}`);
      L.push('');
    });
    return L.join('\n');
  }

  async function copyAll() {
    const t = exportText();
    try {
      await navigator.clipboard.writeText(t);
      toast('已复制 ' + items.length + ' 条，直接粘贴给我即可');
    } catch {
      // 剪贴板被拒时退回手动选中
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;left:8px;top:8px;width:60vw;height:50vh;z-index:2147483647;' +
        'background:#fff;color:#000;font:13px/1.6 ui-monospace,Menlo,monospace;padding:10px';
      document.body.appendChild(ta);
      ta.select();
      toast('剪贴板不可用，已展开文本框，请手动复制后点页面任意处关闭');
      const rm = () => { ta.remove(); document.removeEventListener('mousedown', rm); };
      setTimeout(() => document.addEventListener('mousedown', rm), 400);
    }
  }

  function toast(msg) {
    el.tip.textContent = msg;
    el.tip.classList.add('on');
    setTimeout(() => {
      el.tip.classList.remove('on');
      el.tip.textContent = '元素点选模式 — 点击元素或按 c 添加批注，Esc 退出';
    }, 2600);
  }

  /* ── 面板开关与事件 ── */

  function openPanel() { panelOpen = true; el.panel.classList.add('on'); render(); }
  function togglePanel() { panelOpen = !panelOpen; el.panel.classList.toggle('on', panelOpen); if (panelOpen) render(); }

  el.fab.onclick = togglePanel;
  $('.close').onclick = togglePanel;
  el.elem.onclick = () => setMode(mode === 'element' ? null : 'element');
  $('.copy').onclick = copyAll;
  $('.clear').onclick = async () => {
    if (!items.length) return;
    const before = items.slice();
    items = [];
    if (!await persist(before)) return;
    render();
    offerUndo(`已清空 ${before.length} 条批注`, () => { items = before; });
  };
  $('.save').onclick = () => save(el.ta.value);
  $('.cancel').onclick = closeEditor;
  el.ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(); return; }
    if (e.key !== 'Enter') return;
    /* 中文输入法选词也是敲回车。不挡住 composing，打一半的拼音会被当成确认存进去。
       Safari 有时不给 isComposing，所以补一个 keyCode 229 的判断。 */
    if (e.isComposing || e.keyCode === 229) return;
    if (e.shiftKey) return;                    // Shift+Enter 留给换行
    e.preventDefault();
    save(el.ta.value);                         // 空内容由 save() 拦下并提示
  });

  /* 光标在输入框里就不能抢键——用户可能正在页面自己的搜索框里打字。
     contenteditable 也算，富文本编辑器都是这种。 */
  const typing = (t) => !!t && (t.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode === 'element') setMode(null);
    if (e.key !== 'c' && e.key !== 'C') return;
    // ⌘C / Ctrl+C 是复制，Alt+C 可能是页面或输入法的组合键，一律不接管
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (pending) return;                       // 编辑框开着，c 是正文里的一个字符
    if (typing(e.target) || host.contains(e.target)) return;

    if (mode === 'element') {
      if (!hoverEl || !hoverEl.isConnected || host.contains(hoverEl)) {
        return toast('把鼠标移到要批注的元素上，再按 c');
      }
      e.preventDefault();
      const t = hoverEl;
      openEditor(makeLocator(t, norm(t.textContent).slice(0, MAX_QUOTE)), t.getBoundingClientRect());
      setMode(null);
      return;
    }

    const sel = selectionLoc();
    if (!sel) return toast('先选中一段文字，再按 c 批注');
    e.preventDefault();
    openEditor(sel.loc, sel.rect);
  });

  if (hasExt && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.cmd === 'toggle-panel') togglePanel();
      if (m?.cmd === 'toggle-element-mode') { openPanel(); setMode(mode === 'element' ? null : 'element'); }
    });
  }

  /* ── 启动 ── */
  store.get().then((v) => { items = v; render(); });

  window.__pageComment = { exportText, get items() { return items; }, makeLocator, resolve, render };
})();
