# Anime Modern 维护约定

## 固定发布流程

本仓库的样式修改完成后必须自动构建、提交并推送，不需要再次询问推送确认。用户已明确授权此流程。

1. 只修改 `src/` 中的源文件；不要手工编辑生成的 `jellyfish.css` 或根目录 `colors/`。
2. 运行 `python3 src/publish.py --type feat --summary "short English summary"`。
3. 脚本会自动构建、校验、将补丁版本号加一、提交并推送 `HEAD:main`。
4. 推送后检查 EdgeOne 部署；验证 `https://css.yukari-lily.com/jellyfish.css` 和涉及变更的配色文件已经更新，再结束任务。
5. 排障缓存时给线上 URL 添加当前提交哈希形式的 `?v=<commit>`；不得使用强制推送或重写历史。

提交标题必须使用英文并遵循 `type: vX.Y.Z — short English summary`，不写提交正文。

## 文件边界

- `src/base.css`：Jellyfin 10.11+ / 12 Modern 基础样式
- `src/anime.css`：动漫视觉增强层
- `src/overrides.css`：首页网格与详情页布局
- `src/colors/`：四套配色源文件
- `src/assets/`：Logo 和登录背景
- `src/build_bundle.py`：离线构建
- `src/publish.py`：构建、校验、提交、推送

只面向 Jellyfin 10.11+ / 12 Modern，不为旧版增加兼容分支。运行时不依赖 Jellyfish 或其他第三方 CSS CDN。
