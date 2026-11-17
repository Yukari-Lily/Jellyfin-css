/* item-links.js —— 详情页那行信息里加两个胶囊：Bangumi、TMDB
 *
 * 加在哪：`.itemMiscInfo-primary`（「2025  TV-14  ★ 6.9」那一行）的末尾，样式沿用
 *        主题里已有的 `.mediaInfoItem` 胶囊（src/overrides.css），本脚本只管内容与地址。
 *
 * 地址从哪来：
 *   TMDB     —— 网页端详情接口用的是全字段 DtoOptions，`ExternalUrls` 会被 renderLinks()
 *               写成 `.itemExternalLinks a`，主题只是把它 display:none 藏了。所以直接
 *               读那条 <a href>，不用再发请求、不用 token。
 *   Bangumi  —— 这个库里没有 Bangumi provider id（实测 25889 条，0 个），装插件会改媒体库，
 *               所以用 Bangumi 公开接口按「标题 + 年份区间」查一次 subject id，直达条目页：
 *               POST https://api.bgm.tv/v0/search/subjects  （CORS: *，实测 ~500ms）
 *               查不到 / 超时 / 被限流 → 胶囊留在 `bgm.tv/subject_search/<标题>` 搜索页，
 *               不报错、不空白、不挡页面。
 *
 * 不碰服务端数据、不改媒体文件、不写 CSS；只在网页端详情页生效。
 * 由同目录 boot.js 加载；index.html 里只需要一条 boot.js 的标签。
 *
 * 可选配置（在加载本脚本之前写 window.__jfItemLinksConfig）：
 *   debug: true   // 打日志
 *   bgm: false    // 关掉 Bangumi 查询（只留 TMDB 胶囊）
 */
(() => {
  'use strict';

  if (window.__jfItemLinks) return;
  window.__jfItemLinks = true;

  const CFG = Object.assign({ debug: false, bgm: true }, window.__jfItemLinksConfig || {});

  const PILL_CLASS = 'mediaInfoItem mediaInfoItem-link';
  const CACHE_KEY = 'jl.bgm.v1';
  const EXACT_URL = 'https://bgm.tv/subject/';
  const SEARCH_URL = 'https://bgm.tv/subject_search/';
  const API_URL = 'https://api.bgm.tv/v0/search/subjects?limit=6';
  const TTL_HIT = 90 * 864e5;    // 查到的 subject id 缓存 90 天
  const TTL_MISS = 7 * 864e5;    // 没查到的也记一笔，7 天内不再问
  const TIMEOUT = 4000;          // 接口最多等 4s，超时就退回搜索链接
  const GAP = 1200;              // 两次查询的最小间隔（Bangumi 建议低频访问）
  const MAX_TITLE = 80;
  const MAX_ENTRIES = 400;

  const BGM_HOST = /(^|\.)(bgm\.tv|bangumi\.tv)$/i;
  const TMDB_HOST = /(^|\.)themoviedb\.org$/i;
  const ROUTE = /^#\/details/i;

  // 用户能看到的字都用 \u 转义，避免直接打开 .js 时被当成 GBK 读出乱码
  const TIP = {
    search: '\u5728 Bangumi \u641c\u7d22\u8be5\u756a\u5267', // 在 Bangumi 搜索该番剧
    bgm: '\u5728 Bangumi \u6253\u5f00\u6761\u76ee',          // 在 Bangumi 打开条目
    tmdb: '\u5728 TMDB \u6253\u5f00\u6761\u76ee'             // 在 TMDB 打开条目
  };
  const PLATFORM_MOVIE = '\u5267\u573a\u7248';                // 剧场版

  const log = (...args) => { if (CFG.debug) console.log('[item-links]', ...args); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ 缓存

  function cacheRead() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const map = raw ? JSON.parse(raw) : {};
      return map && typeof map === 'object' ? map : {};
    } catch (e) {
      return {};
    }
  }

  function cacheWrite(map) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(map)); } catch (e) { /* 隐私模式写不了就算了 */ }
  }

  function cacheGet(key) {
    const entry = cacheRead()[key];
    if (!entry || typeof entry.t !== 'number') return undefined;
    return Date.now() - entry.t <= (entry.id ? TTL_HIT : TTL_MISS) ? entry : undefined;
  }

  function cacheSet(key, id) {
    const map = cacheRead();
    map[key] = { id: id || 0, t: Date.now() };
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => (map[a].t || 0) - (map[b].t || 0));
      keys.slice(0, keys.length - MAX_ENTRIES + 50).forEach((k) => delete map[k]);
    }
    cacheWrite(map);
  }

  // ------------------------------------------------------------------ 查询

  let chain = Promise.resolve();
  let lastAt = 0;
  const inflight = new Set();

  // 所有查询排成一条队列，相邻两次至少隔 GAP 毫秒
  function enqueue(task) {
    const run = chain.then(async () => {
      const wait = lastAt + GAP - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
      return task();
    }).catch(() => 0);
    chain = run.then(() => {}, () => {});
    return run;
  }

  async function search(title, year, kind) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : 0;
    try {
      const filter = { type: [2] }; // 2 = 动画
      if (year) filter.air_date = ['>=' + (year - 1) + '-01-01', '<' + (year + 1) + '-12-31'];
      const res = await fetch(API_URL, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ keyword: title, filter }),
        signal: ctl ? ctl.signal : undefined
      });
      if (!res || !res.ok) {
        log('search failed', res && res.status, title);
        return 0;
      }
      const data = await res.json();
      const list = (data && Array.isArray(data.data) ? data.data : [])
        .filter((s) => s && typeof s.id === 'number');
      if (!list.length) return 0;
      const prefer = kind === 'movie' ? [PLATFORM_MOVIE] : ['TV', 'WEB'];
      const hit = list.find((s) => prefer.indexOf(s.platform) >= 0) || list[0];
      log('search', title, year, '->', hit.id, hit.platform, hit.date);
      return hit.id || 0;
    } catch (e) {
      log('search error', e && e.message);
      return 0;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ DOM

  function page$() {
    const list = document.querySelectorAll('#itemDetailPage');
    if (!list.length) return null;
    // 从一个详情页点进另一个详情页时，客户端会再建一个 #itemDetailPage（同 id 两份），
    // 旧的留在 DOM 里并加 .hide。所以取「可见且已布局」的最后一个，而不是 getElementById。
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i];
      if (el.classList.contains('hide')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return el;
    }
    return list[list.length - 1];
  }

  function row$() { const p = page$(); return p ? p.querySelector('.itemMiscInfo-primary') : null; }

  function titleOf(page) {
    const el = page && page.querySelector('.nameContainer .itemName');
    const text = el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    return Array.from(text).slice(0, MAX_TITLE).join('');
  }

  function yearOf(page) {
    const el = page && page.querySelector('.itemMiscInfo-primary .mediaInfoItem');
    const m = el ? /(?:19|20)\d{2}/.exec(el.textContent) : null;
    return m ? Number(m[0]) : 0;
  }

  function anchorLabel(a, fallback) {
    const text = a ? a.textContent.replace(/\s+/g, ' ').trim() : '';
    return text && Array.from(text).length <= 12 ? text : fallback;
  }

  // 想要哪几个胶囊：先看外链，Bangumi 没有精确链接时退化成本页标题的搜索
  function wantPills(page) {
    const links = page ? Array.from(page.querySelectorAll('.itemExternalLinks a[href]')) : [];
    let bgm = null;
    let tmdb = null;
    let kind = '';

    for (const a of links) {
      let url;
      try { url = new URL(a.getAttribute('href'), location.origin); } catch (e) { continue; }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;

      if (!bgm && BGM_HOST.test(url.hostname)) bgm = { a, url };

      if (!tmdb && TMDB_HOST.test(url.hostname) && !/^\/collection(\/|$)/.test(url.pathname)) {
        tmdb = { a, url };
        kind = /^\/tv\/\d+\/?$/.test(url.pathname) ? 'series'
          : /^\/movie\/\d+\/?$/.test(url.pathname) ? 'movie' : '';
      }
    }

    const out = [];

    if (bgm) {
      out.push({ key: 'bangumi', href: bgm.url.href, label: anchorLabel(bgm.a, 'Bangumi'), tip: TIP.bgm, icon: 'open_in_new' });
    } else if (CFG.bgm && kind && titleOf(page)) {
      const title = titleOf(page);
      const year = yearOf(page);
      out.push({
        key: 'bangumi',
        href: SEARCH_URL + encodeURIComponent(title),
        label: 'Bangumi',
        tip: TIP.search,
        icon: 'search',
        query: title,
        year,
        kind,
        cacheKey: title.toLowerCase() + '|' + year + '|' + kind
      });
    }

    if (tmdb) {
      out.push({ key: 'tmdb', href: tmdb.url.href, label: anchorLabel(tmdb.a, 'TMDB'), tip: TIP.tmdb, icon: 'open_in_new' });
    }

    return out;
  }

  function create(w) {
    const el = document.createElement('a');
    el.className = PILL_CLASS;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    el.dataset.jlPill = w.key;
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.setAttribute('aria-hidden', 'true');
    el.appendChild(icon);
    el.appendChild(document.createTextNode(w.label));
    el.dataset.jlLabel = w.label;
    return el;
  }

  // 只在值真的不同时才写，避免自己的写入再次触发 MutationObserver 造成空转
  function paint(el, w) {
    const resolved = el.dataset.jlResolved;
    const href = resolved ? EXACT_URL + resolved : w.href;
    const tip = resolved ? TIP.bgm : w.tip;
    const icon = resolved || w.icon === 'open_in_new' ? 'open_in_new' : 'search';

    if (el.getAttribute('href') !== href) el.setAttribute('href', href);
    if (el.getAttribute('title') !== tip) el.setAttribute('title', tip);

    const span = el.querySelector('.material-icons');
    if (span && span.textContent !== icon) span.textContent = icon;

    if (el.dataset.jlLabel !== w.label) {
      el.dataset.jlLabel = w.label;
      if (el.lastChild && el.lastChild.nodeType === 3) el.lastChild.nodeValue = w.label;
    }
  }

  function upgrade(el, w) {
    if (!w.cacheKey || el.dataset.jlResolved) return;

    const cached = cacheGet(w.cacheKey);
    if (cached) {
      if (cached.id) {
        el.dataset.jlResolved = String(cached.id);
        paint(el, w);
      }
      return;
    }
    if (inflight.has(w.cacheKey)) return;

    inflight.add(w.cacheKey);
    enqueue(() => search(w.query, w.year, w.kind)).then((id) => {
      inflight.delete(w.cacheKey);
      cacheSet(w.cacheKey, id);
      if (!id) return;
      const row = row$();
      const live = row && row.querySelector('[data-jl-pill="bangumi"]');
      // 页面可能已经翻到别的条目了：只在还是同一部番剧时才改
      if (!live || live.dataset.jlWantKey !== w.cacheKey) return;
      live.dataset.jlResolved = String(id);
      const page = page$();
      const current = page ? wantPills(page).find((x) => x.key === 'bangumi') : null;
      paint(live, current || w);
    });
  }

  function clearAll() {
    document.querySelectorAll('[data-jl-pill]').forEach((el) => el.remove());
  }

  function sync() {
    if (!ROUTE.test(location.hash)) { clearAll(); return; }

    const page = page$();
    const row = row$();
    if (!row) return;

    // 同 id 的旧详情页（已被 .hide 藏起来）里不留上次的胶囊：万一客户端把它重新显示出来，
    // 不会先闪一帧别的条目的链接。
    document.querySelectorAll('#itemDetailPage').forEach((p) => {
      if (p === page) return;
      p.querySelectorAll('[data-jl-pill]').forEach((el) => el.remove());
    });

    const want = wantPills(page);

    // 1) 不需要的摘掉（换条目、外链变了、离开详情页）
    row.querySelectorAll('[data-jl-pill]').forEach((el) => {
      if (!want.some((w) => w.key === el.dataset.jlPill)) el.remove();
    });

    // 2) 需要的补上 / 更新
    const nodes = want.map((w) => {
      let el = row.querySelector('[data-jl-pill="' + w.key + '"]');
      if (!el) el = create(w);
      const wantKey = w.cacheKey || '';
      if (el.dataset.jlWantKey !== wantKey) {
        // 换了番剧：上一条的解析结果作废
        delete el.dataset.jlResolved;
        el.dataset.jlWantKey = wantKey;
      }
      paint(el, w);
      return el;
    });

    // 3) 位置：紧跟在原有信息后面，顺序 Bangumi → TMDB（已就位就不动 DOM）
    const tail = Array.prototype.slice.call(row.children, -nodes.length || row.children.length);
    const inPlace = nodes.length > 0 && tail.length === nodes.length && tail.every((n, i) => n === nodes[i]);
    if (!inPlace) nodes.forEach((n) => row.appendChild(n));

    // 4) Bangumi 走查询：命中后原地升级成条目页地址
    want.forEach((w, i) => { if (w.key === 'bangumi') upgrade(nodes[i], w); });
  }

  // ------------------------------------------------------------------ 触发

  let raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; sync(); });
  }

  function onRouteChange() {
    schedule();
    [0, 400, 1200, 2500].forEach((ms) => setTimeout(sync, ms));
  }

  function boot() {
    const root = document.body || document.documentElement;
    try {
      new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    } catch (e) { /* 老浏览器没有 MutationObserver：还有下面的定时复查 */ }

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);

    schedule();
    [0, 300, 1000].forEach((ms) => setTimeout(sync, ms));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
