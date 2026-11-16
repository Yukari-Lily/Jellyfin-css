# Jellyfin CSS — 自托管的 Jellyfish 主题样式

给 `ani.yukari-lily.com`（Jellyfin 12）用的前端样式，替代原来从 jsDelivr 直接拉取的方式：
一个 CSS + 字体 + 图片，全部同域，EdgeOne Pages 托管。

## 结构

```
jellyfin.css         ← 站点实际加载的样式（已内联主题 + 调色板 + 覆盖规则）
edgeone.json         ← 响应头：CORS + 缓存策略（由生成脚本产出，一般不用手改）
fonts/               ← 字体（图标字体 + Quicksand）
img/                 ← 背景图 + 站点 logo
src/overrides.css    ← 只有这个是你手写的样式
src/build_bundle.py  ← 生成脚本
patch/               ← 网页端补丁（不是样式，独立路径 /patch/，见下）
```

## Jellyfin 里怎么用

控制台 → 常规 → 品牌 → 自定义 CSS，只留这一行：

```css
@import url("https://css.yukari-lily.com/jellyfin.css");
```

## 配色

配色已经内联进 `jellyfin.css`，**只保留一行 import，不需要额外引入任何 CSS**。

当前内置：夜樱 Sakura（樱粉暖紫）。

如果需要换色，改这一处即可（由维护方重推，不需要动 Jellyfin 设置）：编辑 `src/colors/anime-*.css` 或在构建时指定 `--palette`，可选 `anime-hoshizora`、`anime-sakura`、`anime-matcha`、`anime-hinata`：

```bash
python3 src/build_bundle.py --palette anime-matcha --overrides src/overrides.css --out /tmp/build
```

配色文件只覆盖颜色变量，不包含 `--logo`、`--background-image`、字体、字号或布局规则。

## 改样式

1. 编辑 `src/overrides.css`
2. 重新生成（需要 Python 3）：

```bash
python3 src/build_bundle.py --overrides src/overrides.css --out .
```

3. 提交推送，EdgeOne 会自动重新部署：

```bash
git add -A && git commit -m "style: v1.0.1 — 调整 xxx" && git push
```

> EdgeOne 项目设置里不需要构建命令，输出目录就是仓库根目录。

主题作者更新 Jellyfish 后，同样跑一次生成脚本即可跟上（默认锁在 `@main`；
想固定版本加 `--base https://cdn.jsdelivr.net/gh/n00bcodr/Jellyfish@v1.2.3`）。

## 这个样式做了什么

- **收色**：强调色只留在图标块、悬停、进度条；分区标题转白、面板半透明黑
- **我的媒体**：等宽网格（6/5/4/3/2 列自适应），不再按文字长度参差
- **详情页**：背景 45vh→20vh、封面与 logo 同顶、标题 2.4rem、按钮与标题同排、去掉 IMDb/TMDB 行
- 兼容 Jellyfin 12 的 modern 首页（`#indexPage` / `#homeTab` / `.homeLibraryButton` 结构未变）

## 注意

- `fonts/` 必须带 `Access-Control-Allow-Origin`，否则跨域字体被浏览器拦掉（由 `edgeone.json` 提供）
- 改完 `jellyfin.css` 后如果浏览器还是旧的：刷 5 分钟缓存或强刷

## 网页端补丁（可选，不是样式）

`patch/` 放的是**网页端 JS 补丁**，和主题样式完全分开：主题仍然只有一个 CSS 入口，
`jellyfin.css` 里没有任何 JS 或指向 `patch/` 的引用。

- `patch/boot.js` —— 总入口：加载 danmaku 弹幕 + `home-poster.js`（省掉 index.html 里手写两行）
- `patch/home-poster.js` —— 首页「最近添加」用番剧海报，不再用季海报

在 Jellyfin 网页端 `index.html` 的 `</body>` 前加这一行即可（原来那行 danmaku 可以删掉）：

```html
<script src="https://css.yukari-lily.com/patch/boot.js" defer></script>
```

- `/patch/*` 走 `no-cache`：改完补丁刷新页面即生效，`index.html` 只需写一次、不用再改
- Jellyfin 升级会还原 `index.html`，升级后补回这一行（脚本本体在 EdgeOne，不会丢）

补丁的行为要点：

- 幂等：每次扫描按“当前图片地址”判断，客户端切页面回来重绘成季海报时会再纠正一次
- 凭据从 `localStorage.jellyfin_credentials` 现读，登录完成后才写入也能生效
- 整行合并成一次 `GET /Items?ids=…&fields=SeriesPrimaryImageTag`，失败重试 3 次后放弃（保持原样，不裂图）
- 只处理首页「最近添加」行；想连「Next Up」一起换，在加载前加 `window.__jfHomePosterConfig = { includeNextUp: true }`
- 只在网页端生效；电视/手机 App 不加载这段代码
- 依赖网页端卡片结构（`.card[data-type="Episode"]`、`.cardImageContainer` 的 `data-src` / `background-image`），
  Jellyfin 大版本若改动这些，脚本会静默失效（不报错、不影响页面）

验证方法见 `patch/` 之外的本文件上文，或直接用下面这段在首页 Console 复核
（`bad` 应为 0，`skip` 是番剧本身没图的条目）：

```js
(async () => {
  const s = JSON.parse(localStorage.jellyfin_credentials).Servers[0];
  const h = { Authorization: `MediaBrowser Token="${s.AccessToken}"` };
  const cards = [...document.querySelectorAll('.verticalSection')]
    .filter(x => x.querySelector('a[href*="section=latest"]'))
    .flatMap(x => [...x.querySelectorAll('.card[data-type="Episode"]')]);
  const ids = [...new Set(cards.map(c => c.dataset.id))];
  const r = await (await fetch(`${location.origin}/Items?ids=${ids.join(',')}&fields=SeriesPrimaryImageTag`, { headers: h })).json();
  const series = Object.fromEntries(r.Items.map(i => [i.Id, i.SeriesId]));
  let ok = 0, bad = 0, skip = 0;
  cards.forEach(c => {
    const img = c.querySelector('.cardImageContainer');
    const u = (img && (img.dataset.src || img.style.backgroundImage)) || '';
    const id = (u.match(/\/Items\/([0-9a-f]{32})\//) || [])[1];
    const sid = series[c.dataset.id];
    if (!sid || !id) { skip++; return; }
    id === sid ? ok++ : bad++;
  });
  return { cards: cards.length, ok, bad, skip };
})()
```
