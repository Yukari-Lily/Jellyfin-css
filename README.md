# Anime Modern · Jellyfin 独立自部署主题

给 `ani.yukari-lily.com`（Jellyfin 12 Modern）使用的动漫主题。设计参考 Jellyfish，但构建与运行均不依赖 Jellyfish CDN。一个 CSS 入口、四套配色、字体和图片全部由 EdgeOne Pages 同域提供。

## 默认安装

控制台 → 常规 → 自定义 CSS：

```css
@import url("https://css.yukari-lily.com/jellyfish.css");
```

默认使用「星穹」蓝紫配色。

## 四套配色

| 配色 | 在主入口后追加 |
| --- | --- |
| 星穹 Hoshizora | 无需追加，默认 |
| 夜樱 Sakura | `@import url("https://css.yukari-lily.com/colors/anime-sakura.css");` |
| 青抹 Matcha | `@import url("https://css.yukari-lily.com/colors/anime-matcha.css");` |
| 日向 Hinata | `@import url("https://css.yukari-lily.com/colors/anime-hinata.css");` |

配色 import 必须位于主入口之后。

## 样式内容

- 动漫海报卡、观看进度、状态徽标和悬浮反馈
- 中日英混排字体与标题层级
- 暗色玻璃顶部栏、Modern MUI 导航、菜单与工具栏
- 详情页播放按钮、剧集列表与紧凑信息面板
- 我的媒体等宽网格，6/5/4/3/2 列自适应
- 移动端、键盘焦点和减少动态效果支持

## 本地构建

编辑 `src/` 中的源文件后运行：

```bash
python3 src/build_bundle.py
```

不需要网络。脚本会重新生成根目录的 `jellyfish.css`、`colors/`、`img/` 和 `edgeone.json`。

## 一键发布（默认流程）

修改完成后直接运行：

```bash
python3 src/publish.py --type feat --summary "update anime theme"
```

脚本会依次执行本地构建、CSS 与资源校验、补丁版本号自动加一、Git 提交和推送 `main`，随后由 EdgeOne 自动部署。修复问题可使用 `--type fix`。没有改动时会直接退出，不产生空提交。

仓库的 `AGENTS.md` 也记录了这一长期约定：以后修改主题后自动推送，并在验证 EdgeOne 线上文件及缓存后结束。

- `src/base.css`：Modern 基础样式
- `src/anime.css`：动漫视觉增强层
- `src/overrides.css`：媒体网格与详情页布局微调
- `src/colors/`：配色源文件
- `src/assets/`：SVG Logo 与登录背景源文件
- `src/fonts-*.css`：本地字体声明
- `preview/`：可点击切换的配色预览

## 部署与缓存

提交并推送完整仓库，EdgeOne 自动部署。CSS 与配色缓存为 5 分钟；部署后如仍显示旧版，请等待缓存过期或强制刷新 Jellyfin 页面。
