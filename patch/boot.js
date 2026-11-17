/* boot.js —— 网页端补丁总入口（一个 <script> 标签搞定）
 *
 * 在 index.html 的 </body> 前加这一行即可（不需要版本参数）：
 *   <script src="https://css.yukari-lily.com/patch/boot.js" defer></script>
 *
 * 它并行加载：
 *   1) danmaku 弹幕（原来手写在 index.html 里那条 jsDelivr 脚本，现由这里统一带上）
 *   2) home-poster.js（首页「最近添加」用番剧海报而不是季海报）
 *   3) item-links.js（详情页信息行加 Bangumi / TMDB 两个胶囊）
 *
 * 已存在同源标记的脚本会跳过，所以新旧写法混用也不会重复执行。
 *
 * 这个文件不属于主题（主题只有一个 CSS 入口），只负责网页端补丁，路径与 CSS 分开。
 */
(() => {
  'use strict';

  if (window.__jfPatchBooted) return;
  window.__jfPatchBooted = true;

  const self = document.currentScript;
  const here = self && self.src ? self.src.replace(/[^/]*$/, '') : 'https://css.yukari-lily.com/patch/';
  // 若有人给 boot.js 加了 ?v=（排查缓存时临时用），把同样的查询串传给同目录的补丁；
  // 平时不需要：/patch/* 是 no-cache，改完刷新即生效
  const qs = self && self.src && self.src.includes('?') ? self.src.slice(self.src.indexOf('?')).split('#')[0] : '';

  // danmaku 自托管在 /patch/danmaku.js（原样取自 Izumiko/jellyfin-danmaku@05b7d05 的 ede.user.js），
  // 不再从 jsDelivr 的可变分支加载：那等于让第三方随时往你的 Jellyfin 页面里推代码。
  const DANMAKU = here + 'danmaku.js';
  const HOME_POSTER = here + 'home-poster.js' + qs;
  const ITEM_LINKS = here + 'item-links.js' + qs;

  function load(url, marker) {
    if (document.querySelector(`script[src*="${marker}"]`)) return; // 页面里已经手写过同一条，跳过
    const el = document.createElement('script');
    el.src = url;
    el.async = true;
    el.dataset.jfPatch = marker;
    el.onerror = () => {
      // 带查询串的地址挂掉时，退回不带查询串的地址再试一次（部署滞后/边缘 504 的常见表现）
      const bare = url.split('?')[0];
      if (bare !== url) {
        const retry = el.cloneNode();
        retry.dataset.jfRetry = marker;
        retry.src = bare;
        document.head.appendChild(retry);
      }
      if (window.console) console.warn('[jf-patch] failed to load', url);
    };
    document.head.appendChild(el);
  }

  load(DANMAKU, 'jellyfin-danmaku');
  load(HOME_POSTER, 'home-poster.js');
  load(ITEM_LINKS, 'item-links.js');
})();
