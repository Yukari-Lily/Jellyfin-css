# patch/ —— 网页端补丁（不是主题样式）

主题只有一个 CSS 入口（`jellyfin.css`），这里放的是**网页端 JS 补丁**，与样式分路径发布：

- `boot.js`：总入口。加载 danmaku 弹幕脚本 + 同目录的 `home-poster.js`。
- `home-poster.js`：首页「最近添加」这一行改用**番剧海报**，不再用季海报。

## 为什么需要 home-poster

Jellyfin 12 的首页「最近添加」行渲染的是「集」，客户端给这一行加了
`preferParentPoster: true`（jellyfin-web 提交 `d91a96e2`，2026-07-09；10.11 没有），
于是卡片取的是「父级＝季」的 Primary 图，整行看起来都是季封面。

脚本只改网页端的图片地址：把 `/Items/<季id>/Images/Primary?tag=<季tag>`
换成 `/Items/<番剧id>/Images/Primary?tag=<番剧tag>`（用的是接口本来就返回的
`SeriesId` / `SeriesPrimaryImageTag`）。不碰服务端数据、不改 CSS、不动媒体文件。

## 用法（Jellyfin 网页端 index.html）

在 `</body>` 前加一行，原来手写的 danmaku 那行可以删掉（boot.js 会带上）：

```html
<script src="https://css.yukari-lily.com/patch/boot.js?v=1" defer></script>
```

Jellyfin 升级会覆盖 `jellyfin-web/index.html`，升级后补回这一行即可；脚本本体在 EdgeOne，不会丢。

改完补丁把 `?v=` 递增一次即可：`boot.js` 会把自己的查询串传给 `home-poster.js`，
两个文件一起换新（EdgeOne 对 `/patch/*` 是 60 秒缓存，`?v=` 用来免掉这段等待）。

补丁是幂等的：每次扫描都按"当前图片地址"判断，客户端切页面回来把卡片重绘成季海报时会再纠正一次。

## 验证

首页（`#/home`）F12 → Console，看 `bad` 是否为 0：

```js
(async () => {
  const s = JSON.parse(localStorage.jellyfin_credentials).Servers[0];
  const h = { Authorization: `MediaBrowser Token="${s.AccessToken}"` };
  const cards = [...document.querySelectorAll('.verticalSection')]
    .filter(x => x.querySelector('a[href*="section=latest"]'))
    .flatMap(x => [...x.querySelectorAll('.card[data-type="Episode"]')]);
  const ids = [...new Set(cards.map(c => c.dataset.id))];
  const r = await (await fetch(`${location.origin}/Items?ids=${ids.join(',')}&fields=SeriesPrimaryImageTag&userId=${s.UserId}`, { headers: h })).json();
  const series = Object.fromEntries(r.Items.map(i => [i.Id, i.SeriesId]));
  let ok = 0, bad = 0, skip = 0;
  cards.forEach(c => {
    const img = c.querySelector('.cardImageContainer');
    const u = (img && (img.dataset.src || img.style.backgroundImage)) || '';
    const id = (u.match(/\/Items\/([0-9a-f]{32})\/Images\//) || [])[1];
    const sid = series[c.dataset.id];
    if (!sid || !id) { skip++; return; }
    id === sid ? ok++ : bad++;
  });
  console.log({ cards: cards.length, ok, bad, skip });
  return { cards: cards.length, ok, bad, skip };
})()
```

`ok`：已在用番剧海报 · `bad`：仍是季海报（应为 0）· `skip`：番剧本身没图（正常）。

## 边界

- 只在网页端生效；电视 / 手机 App 不加载这段代码。
- 默认只处理「最近添加」行；想连「Next Up」一起换，在加载前加
  `window.__jfHomePosterConfig = { includeNextUp: true }`。
- 依赖网页端的卡片结构（`.card[data-type="Episode"]`、`.cardImageContainer` 的
  `data-src` / `background-image`）。大版本若改了这些，脚本会静默失效（不报错、不影响页面）。
