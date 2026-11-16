/* home-poster.js —— 首页卡片：把「季」海报换成「番剧」海报
 *
 * 背景：Jellyfin 12 的首页「最近添加」行渲染的是「集」，客户端给这一行传了
 *      preferParentPoster: true（jellyfin-web commit d91a96e2），所以卡片取的是
 *      「父级＝季」的 Primary 图，整行看起来都是季封面。
 *
 * 判定方式（不依赖界面语言、不依赖 DOM 里的「更多」链接）：
 *   批量问一次 /Items?ids=…，拿到每集的 SeasonId / SeriesId / SeriesPrimaryImageTag，
 *   然后**只有当卡片当前图片的 id 恰好等于该集的 SeasonId 时**才改写。
 *   已经是番剧图的（季没有海报、客户端自己回落）或本集自己的图，都不动。
 *
 * 改写内容：/Items/<季id>/Images/Primary?…tag=<季tag>
 *        → /Items/<番剧id>/Images/Primary?…tag=<番剧tag>
 *   尺寸/质量等查询参数原样保留。
 *
 * 不碰服务端数据、不改 CSS、不动媒体文件；只在网页端生效。
 * 由同目录 boot.js 加载；index.html 里只需要一条 boot.js 的标签。
 *
 * 可选配置（在加载本脚本之前写 window.__jfHomePosterConfig，一般不需要）：
 *   debug: true                       // 打日志
 *   base / token / userId             // 覆盖自动读取的凭据（仅测试用）
 */
(() => {
  'use strict';

  if (window.__jfHomePosterLoaded) return;
  window.__jfHomePosterLoaded = true;

  const CFG = Object.assign({ debug: false }, window.__jfHomePosterConfig || {});

  const IMG_RE = /(^|\/)Items\/([0-9a-f]{32})\/Images\/Primary(?:\/\d+)?(\?[^"')\s]*)?/i;
  const HOLD_MS = 1500;      // 挂起后最多等这么久，之后先还原原图，绝不长期空白
  const CHUNK = 80;          // 分批请求，避免 ids=… 把 URL 撑到 8KB（414）
  const MAX_ATTEMPTS = 3;    // 同一批最多重试 3 轮
  const RETRY_MS = 1200;
  const FETCH_TIMEOUT = 5000;

  const cache = new Map();     // episodeId -> { seasonId, seriesId, seriesTag } | null
  const attempts = new Map();  // episodeId -> 失败轮次
  const inflight = new Set();  // 正在请求中的 episodeId
  const pending = new Set();   // 待发送的 episodeId
  let flushTimer = 0;
  let scanTimer = 0;
  let retryTimer = 0;

  const log = (...args) => { if (CFG.debug) console.log('[home-poster]', ...args); };

  // ---------------------------------------------------------------- 凭据

  function credentials() {
    const cfg = Object.assign({}, CFG, window.__jfHomePosterConfig || {});
    if (cfg.base && cfg.token) {
      return { base: String(cfg.base).replace(/\/+$/, ''), token: cfg.token, user: cfg.userId || '' };
    }

    // 优先用客户端自己的 ApiClient：它带 base path（子路径部署）且是当前服务器
    const api = window.ApiClient;
    if (api && typeof api.accessToken === 'function' && typeof api.serverAddress === 'function') {
      try {
        const token = api.accessToken();
        const base = api.serverAddress();
        if (token && base) {
          const user = typeof api.getCurrentUserId === 'function' ? api.getCurrentUserId() : '';
          return { base: String(base).replace(/\/+$/, ''), token, user: user || '' };
        }
      } catch (e) {
        /* 落到 localStorage */
      }
    }

    try {
      const store = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
      const servers = store.Servers || [];
      if (!servers.length) return null;
      let server = servers[0];
      if (api && typeof api.serverId === 'function') {
        const id = api.serverId();
        const match = servers.find((s) => s && s.Id === id);
        if (match) server = match;
      }
      if (!server || !server.AccessToken) return null;
      const origin = location.origin && location.origin.startsWith('http') ? location.origin : server.ManualAddress;
      return {
        base: String(origin || '').replace(/\/+$/, ''),
        token: server.AccessToken,
        user: server.UserId || ''
      };
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- 工具

  function onHome() {
    const hash = location.hash || '';
    return hash === '' || hash === '#' || hash === '#/' || hash.startsWith('#/home');
  }

  function imageOf(card) {
    return card.querySelector('.cardImageContainer');
  }

  function currentUrl(img) {
    if (img.dataset.jpOrig) return img.dataset.jpOrig; // 等待接口期间摘掉了地址，看备份
    const src = img.getAttribute('data-src');
    if (src) return src;
    const bg = img.style.backgroundImage || '';
    const match = bg.match(/url\((['"]?)([^'")]+)\1\)/);
    return match ? match[2] : '';
  }

  function urlId(url) {
    const m = url.match(IMG_RE);
    return m ? m[2].toLowerCase() : '';
  }

  // 接口还没答复时先不画：卡片停在模糊占位，避免「先画季海报再换成番剧海报」。
  // 只对还没画出图的元素这么做；已画出图的不动，免得把正确的图打空。
  function holdPending(img, url) {
    if (img.dataset.jpPending || img.style.backgroundImage) return;
    img.dataset.jpOrig = url;
    img.dataset.jpPending = '1';
    img.removeAttribute('data-src');
    img.style.backgroundImage = 'none';
    // 每个元素各自计时：后出现的行不会因为第一行的计时器而只剩很短窗口
    setTimeout(() => {
      if (img.dataset.jpPending) paint(img, img.dataset.jpOrig || url);
    }, HOLD_MS);
  }

  function paint(img, url) {
    img.removeAttribute('data-jp-pending');
    delete img.dataset.jpOrig;
    img.setAttribute('data-src', url);
    img.style.backgroundImage = `url("${url}")`;
    // 懒加载器会给还没加载完的卡片加 lazy-hidden（opacity:0），
    // 我们自己把图画上去时必须一并摘掉，否则图换了却看不见。
    img.classList.remove('lazy-hidden');
    img.classList.add('lazy-image-fadein');
  }

  function swapUrl(url, info) {
    return url.replace(IMG_RE, (whole, prefix, id, query) => {
      const params = (query || '').replace(/([?&])tag=[^&]*/i, `$1tag=${info.seriesTag}`);
      return `${prefix}Items/${info.seriesId}/Images/Primary${params}`;
    });
  }

  // ---------------------------------------------------------------- 扫描

  function collect() {
    const cards = [];
    document.querySelectorAll('.verticalSection .card[data-type="Episode"]').forEach((card) => {
      const img = imageOf(card);
      if (!img || !card.dataset.id) return;
      const url = currentUrl(img);
      if (!url || !IMG_RE.test(url)) return;
      cards.push({ card, img, url });
    });
    return cards;
  }

  function apply(card, img, url) {
    const info = cache.get(card.dataset.id);
    if (!info) {
      // 番剧没有海报，或接口已放弃：把原图还回去（只影响被挂起过的元素）
      if (img.dataset.jpPending) paint(img, img.dataset.jpOrig || url);
      return;
    }

    // 只有「当前画的正是这一季的海报」才改；已经是番剧图/本集图就不动
    if (urlId(url) !== info.seasonId) {
      if (img.dataset.jpPending) paint(img, url);
      return;
    }

    const next = swapUrl(url, info);
    if (next === url) {
      if (img.dataset.jpPending) paint(img, url);
      return;
    }

    paint(img, next);
    img.dataset.jpFixed = '1'; // 仅排查用，不参与判断
    log('swapped', card.dataset.id, next);
  }

  function scan() {
    if (!onHome()) return;
    const cards = collect();
    if (!cards.length) return;

    // 已解析的先落地，不要因为同一行里有一个 id 解析失败就整行等
    cards.forEach(({ card, img, url }) => {
      if (cache.has(card.dataset.id)) apply(card, img, url);
    });

    const unknown = [...new Set(cards.map((c) => c.card.dataset.id))]
      .filter((id) => !cache.has(id) && !inflight.has(id));
    if (!unknown.length) return;

    if (credentials()) {
      cards.forEach(({ card, img, url }) => {
        const id = card.dataset.id;
        if (!cache.has(id) && !inflight.has(id)) holdPending(img, url);
      });
    }
    enqueue(unknown);
  }

  // ---------------------------------------------------------------- 请求

  function enqueue(ids) {
    ids.forEach((id) => pending.add(id));
    // 只排一次队：后续扫描只补充 id，不重置定时器
    //（否则首页幻灯片/动画持续触发扫描时，定时器会被无限推迟，请求永远发不出去）
    if (flushTimer) return;
    flushTimer = setTimeout(flushPending, 16);
  }

  async function flushPending() {
    flushTimer = 0;
    if (!pending.size) return;
    const creds = credentials();
    if (!creds) return; // 还没登录：不缓存、不留 inflight，下次扫描再来

    const batch = [...pending].slice(0, CHUNK);
    batch.forEach((id) => { pending.delete(id); inflight.add(id); });

    let failed = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      let res;
      try {
        const query = `?ids=${batch.join(',')}${creds.user ? `&userId=${creds.user}` : ''}`;
        res = await fetch(creds.base + '/Items' + query, {
          headers: { Authorization: `MediaBrowser Token="${creds.token}"` },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 401 || res.status === 403) {
        // 凭据失效：不计次数，下次扫描再试（不计入失败，避免把卡片判死）
        log('unauthorized, will retry later');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const byId = new Map((data.Items || []).map((item) => [item.Id, item]));
      batch.forEach((id) => {
        const item = byId.get(id);
        attempts.delete(id);
        const hex = (v) => typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v);
        const tag = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v);
        cache.set(id, item && hex(item.SeasonId) && hex(item.SeriesId) && tag(item.SeriesPrimaryImageTag)
          ? { seasonId: item.SeasonId, seriesId: item.SeriesId, seriesTag: item.SeriesPrimaryImageTag }
          : null);
      });
      log('resolved', batch.length);
    } catch (err) {
      failed = true;
      log('items query failed', err);
      let retry = false;
      batch.forEach((id) => {
        const tries = (attempts.get(id) || 0) + 1;
        attempts.set(id, tries);
        if (tries >= MAX_ATTEMPTS) cache.set(id, null); // 放弃：保持原样，绝不裂图
        else retry = true;
      });
      if (retry && !retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = 0; scan(); }, RETRY_MS);
      }
    } finally {
      batch.forEach((id) => inflight.delete(id));
    }

    if (pending.size) {
      enqueue([]); // 还有排队中的 id（超过 CHUNK），继续下一批
    }
    scan();
    if (failed) log('batch failed', batch.length);
  }

  // ---------------------------------------------------------------- 触发

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 30);
  }

  // 切回首页时客户端可能晚一步重绘卡片：补扫几次（幂等，已正确时不会写入）
  const laterTimers = new Set();
  function scheduleSoon() {
    schedule();
    laterTimers.forEach(clearTimeout);
    laterTimers.clear();
    [400, 1200, 2500].forEach((ms) => {
      const t = setTimeout(() => { laterTimers.delete(t); scan(); }, ms);
      laterTimers.add(t);
    });
  }

  let queued = false;
  function scanNextMicrotask() {
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => { queued = false; scan(); });
  }

  function start() {
    const root = document.documentElement || document.body;
    if (!root) {
      document.addEventListener('DOMContentLoaded', start, { once: true });
      return;
    }
    new MutationObserver(scanNextMicrotask).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-src']
    });
    window.addEventListener('hashchange', scheduleSoon);
    window.addEventListener('popstate', scheduleSoon);
    scheduleSoon();
  }

  start();
})();
