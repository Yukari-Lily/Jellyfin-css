/* home-poster.js —— 首页「最近添加」卡片：把季海报换成番剧海报
 *
 * 背景：Jellyfin 12 的首页「最近添加」行渲染的是「集」，卡片图取父级（季）的海报
 *      （jellyfin-web commit d91a96e2 给这行加了 preferParentPoster: true）。
 * 做法：不碰服务端数据、不改 CSS、不动媒体文件。只在网页端把这几个卡片图上
 *      的 /Items/<季id>/Images/Primary?tag=<季tag> 换成 /Items/<番剧id>/Images/Primary?tag=<番剧tag>。
 *      季的 id 和番剧的 id/tag 都来自接口本来就返回的 SeriesId / SeriesPrimaryImageTag。
 *
 * 这不是主题交付物（主题只有一个 CSS 入口）。与 CSS 分路径发布在 /patch/ 下，
 * 由同目录的 boot.js 加载；index.html 里只需要一条 boot.js 的标签。
 *
 * 可选配置（在加载本脚本之前写 window.__jfHomePosterConfig，一般不需要）：
 *   includeNextUp: true   // 连「Next Up」那一行也换
 *   debug: true           // 打日志
 *   base / token / userId // 覆盖自动读取的凭据（仅测试用）
 */
(() => {
  'use strict';

  if (window.__jfHomePosterLoaded) return;
  window.__jfHomePosterLoaded = true;

  const CFG = Object.assign({ includeNextUp: false, debug: false }, window.__jfHomePosterConfig || {});

  // /Items/<32 位 id>/Images/Primary  或  .../Images/Primary/0  ，后面可能带 ?maxWidth=...&tag=...
  // 前面允许是绝对地址的 "/" 或相对地址的开头，替换时原样保留前缀。
  const IMG_RE = /(^|\/)Items\/([0-9a-f]{32})\/Images\/Primary(?:\/\d+)?(\?[^"')\s]*)?/i;
  const LATEST_LINK = 'a[href*="section=latest"]';
  const NEXTUP_LINK = 'a[href*="type=nextup"]';

  const cache = new Map(); // episodeId -> { seriesId, seriesTag } | null
  const attempts = new Map(); // episodeId -> 失败次数（接口抖动时重试，避免整行留在季海报）
  const MAX_ATTEMPTS = 3;
  const pending = new Set();
  let flushTimer = 0;
  let scanTimer = 0;

  const log = (...args) => { if (CFG.debug) console.log('[home-poster]', ...args); };

  function credentials() {
    // 每次现读，允许登录完成后才写入的配置/凭据（不要在加载时就把配置写死）
    const cfg = Object.assign({}, CFG, window.__jfHomePosterConfig || {});
    if (cfg.base && cfg.token) {
      return { base: String(cfg.base).replace(/\/+$/, ''), token: cfg.token, user: cfg.userId || '' };
    }
    try {
      const store = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
      const server = (store.Servers || [])[0];
      if (!server || !server.AccessToken) return null;
      // 客户端本身就在服务器同源下，优先用 location.origin，避免跨域请求
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

  function onHome() {
    const hash = location.hash || '';
    return hash === '' || hash === '#' || hash === '#/' || hash.startsWith('#/home');
  }

  function isTargetSection(card) {
    const section = card.closest('.verticalSection');
    if (!section) return false;
    if (section.querySelector(LATEST_LINK)) return true;
    if (CFG.includeNextUp && section.querySelector(NEXTUP_LINK)) return true;
    // 兜底：标题文字（不同语言/无「更多」链接时）
    const title = section.querySelector('.sectionTitle');
    return !!title && /\u6700\u8fd1\u6dfb\u52a0|\u6700\u8fd1\u66f4\u65b0|Latest|RecentlyAdded|Recently Added/i.test(title.textContent || '');
  }

  function imageOf(card) {
    return card.querySelector('.cardImageContainer');
  }

  function currentUrl(img) {
    if (img.dataset.jpOrig) return img.dataset.jpOrig; // 等待接口期间摘下了地址，先看备份
    const src = img.getAttribute('data-src');
    if (src) return src;
    const bg = img.style.backgroundImage || '';
    const match = bg.match(/url\((['"]?)([^'")]+)\1\)/);
    return match ? match[2] : '';
  }

  // 接口还没答复时，先把"季海报"的地图摘下来：卡片显示模糊占位，而不是先画错再换。
  // 只在图片还没被画出来时这么做；已经画出来的不去动它（避免把正确的图打空）。
  function holdPending(img, url) {
    if (img.dataset.jpPending || img.style.backgroundImage) return;
    img.dataset.jpOrig = url;
    img.dataset.jpPending = '1';
    img.removeAttribute('data-src');
    img.style.backgroundImage = 'none';
    schedulePendingWatchdog();
  }

  function paint(img, url) {
    img.removeAttribute('data-jp-pending');
    delete img.dataset.jpOrig;
    img.setAttribute('data-src', url);
    img.style.backgroundImage = `url("${url}")`;
  }

  let watchdog = 0;
  function schedulePendingWatchdog() {
    if (watchdog) return;
    watchdog = setTimeout(restorePending, 2000);
  }

  // 兜底：万一接口一直没答复，2 秒后把原始地址还回去，绝不留空白卡片
  function restorePending() {
    watchdog = 0;
    document.querySelectorAll('[data-jp-pending]').forEach((img) => {
      const orig = img.dataset.jpOrig;
      if (!orig) return;
      paint(img, orig);
    });
  }

  function swapUrl(url, info) {
    return url.replace(IMG_RE, (whole, prefix, id, query) => {
      const params = (query || '').replace(/([?&])tag=[^&]*/i, `$1tag=${info.seriesTag}`);
      return `${prefix}Items/${info.seriesId}/Images/Primary${params}`;
    });
  }

  // 每次都重新读一遍当前图片地址：客户端在切页面回来时会重绘卡片，
  // 一次性标记会让我们误以为"已经改过"而放过它，所以这里只按地址判断。
  function collect() {
    const cards = [];
    document.querySelectorAll('.verticalSection .card[data-type="Episode"]').forEach((card) => {
      if (!isTargetSection(card)) return;
      const img = imageOf(card);
      if (!img) return;
      const url = currentUrl(img);
      if (!url || !IMG_RE.test(url)) return;
      cards.push({ card, img, url });
    });
    return cards;
  }

  async function fetchSeries(ids) {
    const creds = credentials();
    // 还没登录/凭据还没写进 localStorage 时直接返回：不缓存 null，
    // 否则这一批卡片会在本次会话里永远不再尝试。
    if (!creds) return;
    ids.forEach((id) => pending.add(id));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
      const batch = [...pending];
      pending.clear();
      const query = `?ids=${batch.join(',')}&fields=SeriesPrimaryImageTag${creds.user ? `&userId=${creds.user}` : ''}`;
      try {
        const res = await fetch(creds.base + '/Items' + query, {
          headers: { Authorization: `MediaBrowser Token="${creds.token}"` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const byId = new Map((data.Items || []).map((item) => [item.Id, item]));
        batch.forEach((id) => {
          const item = byId.get(id);
          attempts.delete(id);
          cache.set(id, item && item.SeriesId && item.SeriesPrimaryImageTag
            ? { seriesId: item.SeriesId, seriesTag: item.SeriesPrimaryImageTag }
            : null);
        });
        log('resolved', batch.length);
      } catch (err) {
        log('items query failed', err);
        let retry = false;
        batch.forEach((id) => {
          const tries = (attempts.get(id) || 0) + 1;
          attempts.set(id, tries);
          if (tries >= MAX_ATTEMPTS) {
            cache.set(id, null); // 放弃，保持原样，绝不产生裂图
          } else {
            retry = true;
          }
        });
        if (retry) {
          setTimeout(scan, 1500);
          return; // 失败的这批不再立即重跑，避免短时间内打接口
        }
      }
      scan();
    }, 16);
  }

  function apply(card, img, url) {
    const info = cache.get(card.dataset.id);
    if (!info) {
      // 番剧没有海报，或接口已经放弃：恢复原图（已画好的元素不会被动过）
      if (img.dataset.jpPending) paint(img, img.dataset.jpOrig || url);
      return;
    }

    const next = swapUrl(url, info);
    if (next === url) {
      // 已经是对的那张：如果之前摘过地址，补回去
      if (img.dataset.jpPending) paint(img, url);
      return;
    }

    paint(img, next);
    img.dataset.jpFixed = '1'; // 只作排查用，不再用于跳过
    log('swapped', card.dataset.id, next);
  }

  function scan() {
    if (!onHome()) return;
    const cards = collect();
    if (!cards.length) return;
    const unknown = [...new Set(cards.map((c) => c.card.dataset.id))].filter((id) => !cache.has(id));
    if (unknown.length) {
      // 还不知道该显示哪张：先把这批卡片挂起，避免先画季海报再闪一下换成番剧海报。
      // 但只在"确定能问出结果"时才挂起——读不到凭据就一直挂着会让卡片长时间空白。
      if (credentials()) {
        cards.forEach(({ card, img, url }) => {
          if (!cache.has(card.dataset.id)) holdPending(img, url);
        });
      }
      fetchSeries(unknown);
      return;
    }
    cards.forEach(({ card, img, url }) => apply(card, img, url));
  }

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 30);
  }

  // 切回首页时，客户端可能在 hashchange 之后才把卡片重绘出来，
  // 所以在几个时间点各补扫一次（幂等，已经正确时不会产生任何写入）。
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
    // 观察 documentElement 而不是 body：脚本无论放在 <head> 还是 </body> 前，
    // 都能在客户端渲染出第一张卡片之前就开始监听（不受 defer 执行顺序影响）。
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
