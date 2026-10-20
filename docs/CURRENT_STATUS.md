# 设备管理项目交接卡

> 最后更新：2026-10-21
> 当前事实以本卡为准；稳定规则见 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)，历史记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 当前目标

用户已授权整理和修复前端。本批完成动效组件注册、卡片入场策略、组件数据边界和局部类型检查门禁，保留既有 Vue / Node.js / SQLite 技术栈。页面模块和后端分层仍待后续批次处理。

## 第一待办

审阅并将本批修复与配套的既有前端改动一起提交。推送 main 后确认 GitHub Actions 的 typecheck、测试、构建和部署结果；随后由用户手动验收桌面和手机页面。不要只提交工作流而漏掉 package 脚本、组件、类型、tsconfig、Vite JSX 配置或锁文件。

用户于 2026-10-21 确认已在本地运行测试、体验正常，并授权推送及继续整理。用户未提供测试命令和完整输出，不据此宣称全部检查通过。Agent 未运行本地类型检查、测试、构建或浏览器验证；本批正在提交发布，CI/CD 结果待确认。

## 状态快照

| 状态面 | 当前结论 | 证据与范围 |
| --- | --- | --- |
| 本地完成 | 字符串模板使用显式注册的 MotionArticle / MotionButton / MotionDiv；卡片由视口触发位移，内容默认可见，减少动态效果或缺少观察器时静态展示 | 新增 borrow-motion.js；TSX 仍可使用 motion.article |
| 本地完成 | 卡片接收明确类型的设备和展示数据，以类型化事件向父页面回传操作；不再接收六个图片/分类处理函数 | 新增 types/device.ts；父页面按设备缓存 computed 展示数据，避免页脚计时每秒创建新对象 |
| 本地完成 | CI 在测试、构建前增加 npm run typecheck，并新增 Node SSR 原生元素注册与动效策略回归检查 | 类型范围是 TS/TSX 与导入的显式 @ts-check 模块；既有 main.js 尚未纳入完整类型检查 |
| 本地验证 | git diff --check 通过；部署分类确认需要 npm ci、前端构建和服务重启，无持久化目录被列入发布文件 | 静态检查结果；按用户要求未运行类型检查、测试、构建或自动浏览器检查，不能宣称这些检查通过 |
| 服务器同步 | 既有 CI/CD 用户确认首次部署成功；本批修复尚未提交、推送或部署 | 上次部署结果不覆盖本批代码；详细首轮运行日志未重新读取 |
| 生产验证 | 新腾讯云域名 HTTPS 页面入口和证书续期演练已通过，三个服务均 enabled / active | 来自用户回传；本批页面行为、登录、实际借还、图片二维码和真实邮件仍待人工验收 |

## 活跃事项

1. 先完成本批 CI 和人工验收：分类切换后卡片可见、连续下滚入场、设备详情与返回、图片加载/失败、加入和移除借用清单、按钮键盘操作、减少动态效果。
2. 后续按页面边界拆分 frontend/src/main.js，逐步建立 API、状态与展示组件边界；不将本批局部类型检查误称为前端全面 TypeScript 化。
3. 后端仍需逐步分离接口、业务服务和数据访问；SQLite 全量集合读取/回写问题留专项处理，当前没有修改 server.js、数据库或业务 API。

## 生产环境与发布边界

- 当前生产：腾讯云轻量服务器 43.138.146.44，广州四区，2 核 / 2GB、40GB SSD、3Mbps、200GB/月；Ubuntu 26.04 x86_64，ubuntu 具备免密 sudo，已配置 2GiB Swap。
- 公网入口：https://cyb3r.art/borrow 和 https://cyb3r.art/admin。用户回传域名 A 已指向新机，直接 HTTPS 返回 200；Certbot renew --dry-run 成功。
- 应用：/opt/device-management；服务 device-management；应用用户 deviceapp；环境配置 /etc/device-management.env。运行时沿用 Node.js 22，精确版本以服务器输出为准。
- 持久化目录：/var/lib/device-management/data、uploads、qrcodes；SQLite 为 data/device-management.sqlite。发布、回滚代码均不得覆盖生产数据。
- GitHub 仓库 l0x0hhh/cyb3r，main 成功检查后发布对应 SHA。用户已确认受限 SSH 入口安装、Secrets/开关配置及首次自动部署成功。
- 发布入口 /usr/local/sbin/device-management-deploy 由 setup-cd.sh 安装，普通前端改动无需重装该入口。每次自动发布以 deviceapp 安装锁定依赖并构建独立版本，再切换、重启和检查 HTTP/API；失败尝试恢复上一份代码与依赖，不回退业务数据。
- 旧腾讯云 106.55.186.151 应用按最终迁移流程保持停止；京东云 111.228.27.48 和阿里云 47.119.149.116 为历史中间副本，不代表当前生产，不能直接切回旧数据库。

## 已知阻塞与边界

- 本批检查尚未在 CI 执行；此前成功的构建、定向测试和部署仅是历史基线。
- 浏览器桌面与手机检查由用户手动完成；Agent 不启动 Playwright 或安装浏览器依赖。
- 普通用户只展示脱敏借用信息；借出设备不能下线；删除设备必须二次确认。本批未改这些业务规则。
- 不上传 data/、uploads/、public/qrcodes/、frontend/dist/、node_modules/ 或密钥。不要在运行中的生产实例执行占用 3000 端口的集成测试。

## 本轮涉及文件

- 修改：frontend/src/main.js、frontend/src/components/MotionDeviceCard.tsx、package.json、tsconfig.json、.github/workflows/ci.yml、test/frontend-source.test.js、test/ci-workflow.test.js。
- 新增：frontend/src/components/borrow-motion.js、frontend/src/types/device.ts、test/motion-components.test.js。
- 更新说明：docs/CURRENT_STATUS.md、docs/PROJECT_GUIDE.md、docs/CODE_STRUCTURE.md、docs/CI_CD.md、docs/CHANGELOG.md。
- 既有配套未提交改动：frontend/index.html、vite.config.js、package-lock.json，需与组件及依赖一并审阅；AGENTS.md 为用户既有改动，本轮未编辑。
- 未改：后端、数据库、生产持久化数据、发布脚本和既有构建产物。

## 新会话接续

先读本卡，再读 PROJECT_GUIDE.md；按第一待办继续。部署时完整阅读 skills/sync-device-management/SKILL.md 与 docs/CI_CD.md。每轮更新本卡与相关导航，并向 CHANGELOG.md 追加简短记录；不把历史迁移过程复制回本卡，不把本地完成推断为已上线。
