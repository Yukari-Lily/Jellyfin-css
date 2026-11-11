# Jellyfin CSS — 自托管的 Jellyfish 主题样式

给 `ani.yukari-lily.com`（Jellyfin 12）用的前端样式，替代原来从 jsDelivr 直接拉取的方式：
一个 CSS + 字体 + 图片，全部同域，EdgeOne Pages 托管。

## 结构

```
jellyfish.css        ← 站点实际加载的文件（已内联主题 + 调色板 + 覆盖规则）
edgeone.json         ← 响应头：字体 CORS + 缓存策略
fonts/               ← 字体（图标字体 + Quicksand）
img/                 ← 背景图 + 站点 logo
src/overrides.css    ← 只有这个是你手写的
src/build_bundle.py  ← 生成脚本
```

## Jellyfin 里怎么用

控制台 → 常规 → 品牌 → 自定义 CSS，只留这一行：

```css
@import url("https://css.yukari-lily.com/jellyfish.css");
```

## 配色（可选）

只改颜色，不改布局、字号、卡片尺寸和 Logo。在主 import 之后追加一行即可：

| 配色 | 追加 |
| --- | --- |
| 星穹 Hoshizora | `@import url("https://css.yukari-lily.com/colors/anime-hoshizora.css");` |
| 夜樱 Sakura | `@import url("https://css.yukari-lily.com/colors/anime-sakura.css");` |
| 青抹 Matcha | `@import url("https://css.yukari-lily.com/colors/anime-matcha.css");` |
| 日向 Hinata | `@import url("https://css.yukari-lily.com/colors/anime-hinata.css");` |

示例：

```css
@import url("https://css.yukari-lily.com/jellyfish.css");
@import url("https://css.yukari-lily.com/colors/anime-sakura.css");
```

配色文件只覆盖 `--primary-*`、`--secondary-*`、`--*-background-color`、`--text-color`、`--alt-accent-color`、`--primary-alt1~5` 这些颜色变量，不包含 `--logo`、`--background-image`、字体、字号或布局规则，因此不会影响现有自定义。

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
- 改完 `jellyfish.css` 后如果浏览器还是旧的：刷 5 分钟缓存或强刷
