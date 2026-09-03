# 设备管理项目交接卡

> 最后更新：2026-09-03
> 这是新会话的第一入口；稳定规则见 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)，历史变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 当前目标

保持学院设备借还系统可维护、可安全部署；批量借用、批量归还与批量邮件汇总已完成本地验证、远端推送、服务器同步和生产验证；答案之书彩蛋与邮件格式收口已完成本地实现和自动化验证，邮件设置本地配置已直接填入完整正文；SQLite 运行时切换已完成本地实现、迁移演练和回归验证，等待用户确认后再同步服务器和执行生产迁移。

## 第一待办

邮件通知已完成“其他设备”提醒拆分、批量多人分组、测试邮件明细补齐和管理员正文模板直接填入；SQLite 第二阶段已完成运行时读写切换、JSON 首次迁移、事务/WAL 和回归验证；答案之书仍等待用户在桌面端和 390px 移动端手动验收 `/answers` 及归还成功通知，再决定是否推送和同步服务器。

## 状态快照

| 状态面 | 当前结论 | 证据或备注 |
| --- | --- | --- |
| 本地已完成 | 用户端批量借用（卡片"＋加入借用"、底部浮动清单、批量弹窗一次填写、部分冲突提示）；用户端批量归还（归还页勾选多台 + 统一备注一次归还，备注不同走单台各自归还，全选/清除；勾选进批量的设备其单台备注与"确认归还"置灰，单台归还后同步移除勾选）；管理端批量强制归还（当前借出列表勾选 + 统一备注弹窗；勾选后单台"管理员归还"/"修改借用信息"置灰，单台强制归还后同步移除勾选，批量数量实时准确）；邮件通知（其他设备名称保持干净，待上线提醒单独展示且只出现一次，型号/编号缺失有明确兜底；批量借出/批量用户归还/批量管理员归还各发一封，按借用人分组展示，旧模板自动补充明细并避免多人时只显示第一人；管理员邮件设置的三类正文已直接填入完整模板）；SQLite 运行时（`db/schema.sql`、`db/repository.js`、`scripts/migrate-json-to-sqlite.js`；数据库不存在时从旧 JSON 首次迁移，存在后不再读取或写回 JSON；关键跨表写入使用事务，启用 WAL 和 busy timeout）；用户端体验增强（移除顶部重复的可借数量状态条，保留列表标题旁随筛选变化的数量；增加非阻塞借还反馈、选中态、卡片/详情扫描层和归还列表过渡）；答案之书彩蛋（归还成功通知入口、`/answers` 页面、本地随机答案、结果文案自适应换行、“再抽一次”返回答案页首页和返回借还页；左上角标题为“答案之书”）；单台借用/归还/强制归还与单台邮件保持逐台不变 | 新增接口：`POST /api/records/return-batch`（凭证覆盖所选记录，空/超 10 台 400、凭证失效 403、部分冲突返回 conflicts）、`POST /api/records/force-return-batch`（管理员权限、上限 50 台、只写一条 `admin_returned` 汇总日志）和 `POST /api/records/borrow-other`（写入普通借用记录，不改变库存）；`queueEmailNotification`/`queueBatchEmailNotification`/`formatEmailRecordGroup` 统一正式邮件、测试邮件和新旧模板兼容逻辑；启动时读取到历史简略正文会自动返回完整模板；`migrate:sqlite` 只生成迁移副本，不参与业务读写；本地 `data/email-settings.json` 已直接填入完整三类正文；答案之书不新增 API 或持久化数据；本轮未改生产持久化目录 |
| 本地已验证 | 邮件定向测试 11/11、前端契约 87/87、完整测试 194/194；SQLite 专项测试 3/3，真实本地 JSON 迁移演练完成（分类 7、设备 10、记录 144、日志 48、管理员 2、邮件设置 1；完整性 `ok`、WAL 已启用）；`node --check server.js`、`node --check db/repository.js`、`node --check frontend/src/main.js` 和标准 `npm run build` 通过（仅有既有大体积 chunk 提示） | 邮件覆盖其他设备名称/提醒/缺失型号、测试邮件明细、同人批量、多借用人批量、重复设备、旧模板兼容和简略模板自动升级；SQLite 测试覆盖六类数据、其他设备记录、管理员权限、SMTP 密文、WAL、事务回滚和拒绝覆盖；答案页覆盖 `/answers` 路由、参考站点核心文案、初始/翻书/结果状态、长答案换行、“再抽一次”返回首页、复制提示、归还反馈入口和无 API 调用；浏览器桌面端与 390px 移动端、邮件管理页预览和真实 SMTP 收件待用户手动验收；邮件测试使用 `E:\AIstudy\device-management-test-temp` 作为临时目录，避免本机 C 盘空间不足；默认 3000 端口被现有开发服务占用时需使用独立测试端口 |
| 已同步服务器 | GitHub `main` 已推送到 `7f8c507`；服务器运行版本仍为 `84d3fe0`，本轮答案之书和邮件模板改动尚未推送或同步 | 既有 SSH 登录认证阻塞仍在；生产持久化目录未纳入更新，本地 `data/email-settings.json` 也不会作为源码同步 |
| 生产已验证 | 上一版本既有功能和用户端体验增强之前的生产验证保持有效；本轮答案之书彩蛋尚未生产验证 | 待用户本地验收后，在具备服务器登录权限的终端执行同步、构建、服务检查和浏览器验证 |

## 活跃事项

本轮答案之书源码、参考站点静态资源、结果文案溢出修复、首页返回交互，邮件模板/批量分组/旧模板兼容/测试邮件明细/本地配置直接填入，以及 SQLite 运行时读写切换和真实数据演练已完成；等待用户手动检查归还成功通知、`/answers` 三种页面状态、长答案显示、分享复制、邮件管理页预览和真实 SMTP 收件，之后再决定 GitHub 推送与服务器同步；SQLite 生产迁移另行执行。

## 已知阻塞与边界

- 浏览器桌面端、390px 移动端、真实 SMTP 收件和复杂管理操作由用户手动验收；Agent 不启动 Playwright、下载浏览器或安装额外依赖。
- 本轮答案之书只提供娱乐性随机文案，不代表设备管理、健康或其他现实决策建议；答案和用户问题均不写入服务器。
- SQLite 生产数据库默认位于 `/var/lib/device-management/data/device-management.sqlite`；服务器同步只更新源码和构建，不覆盖数据库、旧 JSON 备份、上传图片或二维码。
- 生产持久化数据位于服务器 `/var/lib/device-management`；更新不得覆盖 `data/`、`uploads/`、`public/qrcodes/`、`frontend/dist/` 或 `node_modules/`。

## 本轮涉及文件

- 已改：`server.js`、`db/repository.js`、`frontend/src/main.js`、`frontend/index.html`、本地忽略配置 `data/email-settings.json`、`db/schema.sql`、`scripts/migrate-json-to-sqlite.js`、`package.json`、`public/assets/answer-book.png`、`public/assets/answer-book-icon.png`、`public/assets/answer-book-loading.json`、`public/assets/answer-book.ttf`、`public/assets/dotlottie-player.mjs` 及其本地渲染模块、`test/server.test.js`、`test/frontend-source.test.js`、`test/email-notification.test.js`、`test/database.test.js`、`docs/CURRENT_STATUS.md`、`docs/PROJECT_GUIDE.md`、`docs/CODE_STRUCTURE.md`、`docs/CHANGELOG.md`
- 未改：生产数据、部署脚本与既有构建产物

## 新会话接续

1. 先读本文件，只以"状态快照"和"第一待办"为当前事实。
2. 再读 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) 的产品红线、代码地图和任务路由。
3. 根据任务类型按需打开 `docs/CODE_STRUCTURE.md`、`DEPLOY.md`、`skills/sync-device-management/SKILL.md` 或源码。
4. 用户只说"继续项目"时，从"第一待办"开始；不得把本地完成推断为已部署。

## 维护规则

- 每次任务只更新本卡的当前目标、第一待办、状态快照、活跃事项和阻塞；不要把历史过程追加到本文件。
- 代码、接口、数据模型、产品规则、架构或部署边界变化时，同步更新 `PROJECT_GUIDE.md`；每轮完成后在 `CHANGELOG.md` 追加一条短记录。
- 四种状态必须分开写：本地已完成、本地已验证、已同步服务器、生产已验证。
