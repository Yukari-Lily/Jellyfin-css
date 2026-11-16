# Jellyfin CSS — 自托管的 Jellyfish 主题样式

给 `ani.yukari-lily.com`（Jellyfin 12）用的前端样式，替代原来从 jsDelivr 直接拉取的方式：
一个 CSS + 字体 + 图片随站点托管在 EdgeOne Pages。**元数据图标（Bangumi/TMDB/豆瓣…）仍是
jsDelivr 与 raw.githubusercontent 上的远程图片**，其余资源同域。

## 结构

```
jellyfin.css         ← 站点实际加载的样式（已内联主题 + 调色板 + 覆盖规则）
edgeone.json         ← 响应头：CORS + 缓存策略（由生成脚本产出，一般不用手改）
fonts/               ← 字体（图标字体 + Quicksand）
img/                 ← 背景图 + 站点 logo
src/overrides.css    ← 手写的覆盖层（主要改这个）
src/colors/          ← 调色板（也是手写源，构建时内联）
src/build_bundle.py  ← 生成脚本（产出 jellyfin.css + edgeone.json）
patch/               ← 网页端补丁（不是样式，独立路径，见下）
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

1. 编辑 `src/overrides.css`（或 `src/colors/*.css`）
2. 重新生成到 **临时目录**（需要 Python 3）：

```bash
python3 src/build_bundle.py --overrides src/overrides.css --out /tmp/build
```

> 脚本会**先整个删除输出目录**，所以 `--out` 绝不能指向仓库根（脚本已加护栏，会直接拒绝）。
> 产物里的 `patch/`、`src/`、`README.md`、`img/login-bg.jpg` 都需要保留，只能回拷需要的两个文件。

3. 回拷产物并自增版本号（`src/overrides.css` 里的 `--yukari-version`）：

```bash
cp /tmp/build/jellyfin.css /tmp/build/edgeone.json .
git add -A && git commit -m "fix: v1.2.41 — short English summary" && git push selfhosted HEAD:main
```

> EdgeOne 项目设置里不需要构建命令，输出目录就是仓库根目录。
> 本 worktree 是 detached HEAD，`git push` 不带参数会失败，用上面的 `HEAD:main`。

主题作者更新 Jellyfish 后跑同一条命令即可跟上。**默认锁 `@main`，每次重建都可能带进上游新改动**：
重建后先 `git diff jellyfin.css` 看一遍再发布，别把没审过的上游样式顺手发到生产。
要固定版本加 `--base https://cdn.jsdelivr.net/gh/n00bcodr/Jellyfish@<commit-sha>`
（上游只打过一个 tag `1.0`，`@v1.2.3` 之类的 ref 不存在）。

## 这个样式做了什么

- **收色**：强调色只留在图标块、悬停、进度条；分区标题转白、面板半透明黑
- **我的媒体**：等宽网格（6/5/4/3/2 列自适应），不再按文字长度参差
- **详情页**：背景 45vh→20vh、封面与 logo 同顶、标题 2.4rem、按钮与标题同排、去掉 IMDb/TMDB 行
- 兼容 Jellyfin 12 的 modern 首页（`#indexPage` / `#homeTab` / `.homeLibraryButton` 结构未变）

## 注意

- `fonts/` 必须带 `Access-Control-Allow-Origin`，否则跨域字体被浏览器拦掉（由 `edgeone.json` 提供）
- `fonts/` 是 immutable 一年（文件名固定且内容稳定）；`img/` 的文件名也固定但图会换（登录壁纸），
  所以只给 1 小时缓存，换图后最多 1 小时生效
- `/patch/` 下每个 js 都有独立响应头规则（`no-cache` + `charset=utf-8` + `nosniff`）：
  **新增补丁文件时要在 `src/build_bundle.py` 的名单里加一个名字**，否则会走平台默认头
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

- **按数据判断，不看界面语言**：批量取每集的 `SeasonId / SeriesId / SeriesPrimaryImageTag`，
  只有当卡片当前图片的 id 恰好等于该集的 `SeasonId`（也就是现在画的是季海报）时才改写；
  已经是番剧图或本集自己的图都不动
- 整页合并请求，单次最多 80 个 id（避免 URL 过长 414），单个 id 失败最多重试 3 轮
- 接口没回来之前**不画季海报**：卡片先显示模糊占位，拿到结果一次画上；每个元素最多等 1.5 秒，
  超时先还原原图，绝不留空白。读不到凭据时不挂起
- 换图时一并摘掉懒加载器的 `lazy-hidden`（否则图换了仍不可见）
- 只在网页端首页生效；电视/手机 App 不加载这段代码

在首页 Console 跑下面这段复核（`bad` 应为 0，`skip` 是番剧本身没图的条目；
`cards` 为 0 说明不在首页或「最近添加」还没渲染）：

```js
(async () => {
  const api = window.ApiClient;
  const base = (api && api.serverAddress) ? api.serverAddress() : location.origin;
  const store = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}').Servers?.[0] || {};
  const token = (api && api.accessToken) ? api.accessToken() : store.AccessToken;
  const user = (api && api.getCurrentUserId) ? api.getCurrentUserId() : store.UserId;
  const cards = [...document.querySelectorAll('.verticalSection .card[data-type="Episode"]')];
  if (!cards.length) return '没有集卡片：请确认在首页且「最近添加」已渲染';
  const ids = [...new Set(cards.map((c) => c.dataset.id))];
  const info = {};
  for (let i = 0; i < ids.length; i += 80) {
    const r = await (await fetch(`${base}/Items?ids=${ids.slice(i, i + 80).join(',')}&userId=${user}`,
      { headers: { Authorization: `MediaBrowser Token="${token}"` } })).json();
    (r.Items || []).forEach((it) => { info[it.Id] = it; });
  }
  let ok = 0, bad = 0, skip = 0;
  cards.forEach((c) => {
    const img = c.querySelector('.cardImageContainer');
    const u = (img && (img.dataset.src || img.style.backgroundImage)) || '';
    const id = (u.match(/\/Items\/([0-9a-f]{32})\//i) || [])[1];
    const it = info[c.dataset.id];
    if (!it || !it.SeasonId || !id) { skip++; return; }
    if (id === it.SeriesId) ok++;
    else if (id === it.SeasonId) bad++;
    else skip++;
  });
  return { cards: cards.length, ok, bad, skip };
})()
```
