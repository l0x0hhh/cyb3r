# 设备管理项目交接卡

> 最后更新：2026-08-31
> 这是新会话的第一入口；稳定规则见 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)，历史变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 当前目标

保持学院设备借还系统可维护、可安全部署；当前优先处理邮件通知模板的独立化，并完成最近本地 UI 调整的人工验收。

## 第一待办

将设备借出、用户归还、管理员归还改为三套独立的邮件主题和正文模板，同时兼容旧的 `subjectTemplate` / `bodyTemplate` 配置，并为三类事件提供独立预览和测试发送。

## 状态快照

| 状态面 | 当前结论 | 证据或备注 |
| --- | --- | --- |
| 本地已完成 | 上传与首包优化阶段 1、2；管理员分级、导航和权限修复；管理端 AppBar 满宽样式；用户端顶部品牌栏和借还分段控件统一宽版容器；Noto Sans SC 字体本地化；用户端和管理端页脚合并服务备案号与运行时长；公开设备列表改为响应式独立列式瀑布流；用户端点击粒子特效；PC 端详情页返回体验（返回取消向上收回动效并恢复列表滚动位置） | 字体资源位于 `public/fonts/`，入口改为本地 CSS，移除 Google Fonts 远程引用；用户端顶部使用 1180px 宽版容器，归还查询内容保留 720px 可读宽度，两个 tab 自动均分；备案号与运行时长显示为同一元信息行并链接工信部备案官网；瀑布流按手机 2、平板 3、桌面 4 列分配；粒子特效仅在 `/borrow` 创建 Canvas 并按需加载脚本，`/admin` 不加载 |
| 本地已验证 | AppBar 定向契约 1/1；两个入口语法检查；完整 `npm test` 153/153；点击粒子特效定向契约 1/1；`node --check server.js` 与前端入口通过；标准 `npm run build` 通过（EPERM 阻塞已解除） | 构建仅保留既有大体积 chunk 提示；PC 端详情返回契约测试通过；点击粒子特效和 PC 端详情返回均尚待用户浏览器确认后同步 |
| 已同步服务器 | 生产源码已同步到 `b7c2beb`；服务器当前跟踪 `main`；该提交包含 AppBar 满宽、Noto Sans SC 字体、备案号页脚、设备瀑布流和用户端顶部宽版布局 | 更新脚本输出 `Deployment completed at b7c2bebacfe40112b1a64f42edf642686201ba8a`；本轮点击粒子特效与 PC 端详情返回改动均尚未同步服务器 |
| 生产已验证 | 服务、普通管理员权限隔离、一言、WebP 图片加载和 Nginx 配置已由用户确认；`b7c2beb` 中的 AppBar 满宽、Noto Sans SC 字体、备案号页脚、设备瀑布流和用户端顶部宽版布局已完成生产视觉确认 | 当前仅点击粒子特效尚未同步生产，不能把本地特效验证推断为生产验证 |

## 活跃事项

1. **邮件模板独立化**：当前仍使用共享模板；这是第一待办，需保持旧数据可读和未提交字段沿用当前配置。
2. **用户端点击粒子特效**：仅 `/borrow` 按需加载 Anime.js 和 Canvas 粒子脚本；按钮、表单控件、链接、弹窗点击会过滤；尚未同步服务器，等待本地浏览器验收。
3. **PC 端详情页返回**：返回详情时取消向上收回离场动效并恢复进入前的列表滚动位置；用户确认已实现，工作区含未提交改动；尚未同步服务器，等待浏览器验收。

## 已知阻塞与边界

- 浏览器桌面端、390px 移动端、真实 SMTP 收件和复杂管理操作由用户手动验收；Agent 不启动 Playwright、下载浏览器或安装额外依赖。
- 生产持久化数据位于服务器 `/var/lib/device-management`；更新不得覆盖 `data/`、`uploads/`、`public/qrcodes/`、`frontend/dist/` 或 `node_modules/`。

## 本轮涉及文件

- 已改：`server.js`、`frontend/index.html`、`frontend/src/main.js`、`public/fonts/`、`public/js/anime.min.js`、`public/js/fireworks.js`、`test/build-config.test.js`、`test/frontend-source.test.js`、`test/security-config.test.js`、`docs/CURRENT_STATUS.md`、`docs/PROJECT_GUIDE.md`、`docs/CODE_STRUCTURE.md`、`docs/CHANGELOG.md`
- 未改：生产数据和部署脚本

## 新会话接续

1. 先读本文件，只以“状态快照”和“第一待办”为当前事实。
2. 再读 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) 的产品红线、代码地图和任务路由。
3. 根据任务类型按需打开 `docs/CODE_STRUCTURE.md`、`DEPLOY.md`、`skills/sync-device-management/SKILL.md` 或源码。
4. 用户只说“继续项目”时，从“第一待办”开始；不得把本地完成推断为已部署。

## 维护规则

- 每次任务只更新本卡的当前目标、第一待办、状态快照、活跃事项和阻塞；不要把历史过程追加到本文件。
- 代码、接口、数据模型、产品规则、架构或部署边界变化时，同步更新 `PROJECT_GUIDE.md`；每轮完成后在 `CHANGELOG.md` 追加一条短记录。
- 四种状态必须分开写：本地已完成、本地已验证、已同步服务器、生产已验证。
