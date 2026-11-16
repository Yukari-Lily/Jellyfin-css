/* boot.js —— 网页端补丁总入口（一个 <script> 标签搞定）
 *
 * 在 index.html 的 </body> 前加这一行即可（不需要版本参数）：
 *   <script src="https://css.yukari-lily.com/patch/boot.js" defer></script>
 *
 * 它并行加载：
 *   1) danmaku 弹幕（原来手写在 index.html 里那条 jsDelivr 脚本，现由这里统一带上）
 *   2) home-poster.js（首页「最近添加」用番剧海报而不是季海报）
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
  // 把 boot.js 自己的 ?v= 传给同目录的补丁，改补丁时只需在 index.html 里递增一次
  const qs = self && self.src && self.src.includes('?') ? self.src.slice(self.src.indexOf('?')).split('#')[0] : '';

  const DANMAKU = 'https://cdn.jsdelivr.net/gh/Izumiko/jellyfin-danmaku@gh-pages/ede.user.js';
  const HOME_POSTER = here + 'home-poster.js' + qs;

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
})();
