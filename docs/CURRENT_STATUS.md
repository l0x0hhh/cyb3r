# 设备管理项目交接卡

> 最后更新：2026-10-20
> 这是新会话的第一入口；稳定规则见 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)，历史变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 当前目标

当前新任务：建立 GitHub Actions CI/CD，使推送到 `main` 且 CI 通过的提交自动部署到新腾讯云 `43.138.146.44`。用户已授权，本地工作流、精确 SHA 独立发布、串行锁、健康检查失败恢复、受限 SSH 安装及操作文档已实现。用户回传 setup-cd.sh 安装成功、sudoers parsed OK，现有应用未重启，固定发布入口已就绪。未运行本地测试/构建；用户确认两个 GitHub Secrets 和 CD_ENABLED=true 已配置；13 个 CI/CD 文件已创建本地提交，尚未推送成功，首轮 CI/CD 未触发，不能标记自动部署已启用。

新腾讯云轻量服务器 `43.138.146.44` 已接管 `cyb3r.art` 公网访问，直接 HTTPS 返回 200；证书续期演练成功，应用、Nginx、certbot.timer 均 enabled / active。从旧腾讯云 `106.55.186.151` 迁移，保留生产版本和数据目录。截图确认广州四区、2 核 2GB、40GB SSD、3Mbps 带宽与 200GB/月流量，镜像为 Ubuntu Server 26.04 LTS 64bit；终端确认 ubuntu 具备免密 sudo，Ubuntu 26.04 x86_64，根盘可用 32G、内存可用约 1.5Gi、Swap 2Gi；初始预检仅 SSH 和本机 DNS 监听；随后用户确认运行环境安装与备份校验无问题，具体版本待输出确认。阿里云 `47.119.149.116` 与京东云 `111.228.27.48` 保留为已通过各自本机预检的中间副本，其结果不代表新腾讯云已部署或验证。用户已完成公网 DNS 切换，后续生产写入以新腾讯云为准，旧机应用保持停止；不可直接切回旧数据库。原 CI 与页面验收事项待迁移收尾后继续确认。

## 第一待办

服务器发布入口已安装，用户确认 DEPLOY_PRIVATE_KEY、DEPLOY_KNOWN_HOSTS 与 CD_ENABLED=true 已配置，未读取 Secret 内容。本轮 13 个 CI/CD 文件已创建本地提交，沿用仓库最近提交署名且未修改全局配置；既有功能改动保持未提交。工具环境 SSH 主机校验失败，HTTPS 443 连接超时，推送未成功；已通过 GitHub 连接器确认远端 main 为原 eeab253。下一步由用户在本机 PowerShell 通过 HTTPS 推送 main，再确认 verify/deploy 首轮结果。服务器 ED25519 指纹由安装输出确认为 SHA256:wWbBws0BeI+OdBjmnmCofUw9lKLPaYHcQ4UaW5+0tHI。迁移后的实际登录、借还、图片二维码及邮件仍待用户人工验收；旧机与中间副本保留。

## 状态快照

本轮修改 CI/CD 工作流、发布工具、相关回归检查及说明书，业务功能未修改。遵照用户要求未运行本地测试或构建，仅静态审阅与 diff 格式检查；新增 Linux 临时目录回退演练待 GitHub CI 执行。下方既有功能验证条目仍为历史基线；服务器结果来自用户回传，Agent 未直接登录或部署。

注意：京东云与阿里云各项结果均属于中间副本；新腾讯云 `43.138.146.44` 的公网切换与续期演练已通过，不能与中间副本混淆。表内“已同步服务器”和“生产已验证”保留的是京东云 10 月 16 日历史记录；最新生产结果见“新腾讯云最终目标”及末尾上线进度。

| 状态面 | 当前结论 | 证据或备注 |
| --- | --- | --- |
| 新腾讯云最终目标 | `43.138.146.44`，广州四区，2 核 / 2GB、40GB SSD、3Mbps；Ubuntu 26.04 x86_64，ubuntu 免密 sudo；用户确认应用恢复成功 | 域名 A 已指向新机，直接 HTTPS 返回 200；Certbot 模拟续期成功，device-management、nginx、certbot.timer 均 enabled / active。最终恢复脚本末尾输出未单独回传，实际登录、借还、图片二维码和邮件待人工验收 |
| CI/CD 本地实现 | main CI 成功后按 SHA 发布、两层锁、deviceapp 独立依赖/构建、切换后 HTTP/API 检查、失败恢复完整旧代码与依赖；用户确认 setup-cd.sh 已安装受限 SSH 和 root 固定入口，未重启应用 | 本地未测试/构建；用户确认 GitHub Secrets/开关已配置；提交推送与首轮任务待确认，安装成功不代表 SSH 网络、GitHub 拉取、实际构建及发布已验证。工作区既有功能改动不得自动混入提交。发布数据独立，数据库不随代码回退 |
| 阿里云备份传输 | 用户确认重传后的备份校验值一致，已具备恢复副本 | 目标为 `/root/device-migration-20261020-01/migration.tar.gz`；仅确认备份传输，不等同于软件安装或应用恢复完成 |
| 阿里云中间副本 | `47.119.149.116`，深圳 E 区，2 vCPU / 2 GiB、40 GiB ESSD Entry；root、Ubuntu 24.04.5 x86_64、4Gi Swap；Node.js 22.23.3、npm 10.9.9、Nginx 1.24.0，应用、数据及证书已恢复 | 本机 HTTP/HTTPS 已通过，尚未公网切换；已不作为最终目标，原接入备案申请状态保留，未自动取消或删除实例 |
| 阿里云 HTTPS 与续期准备 | 用户回传 Nginx 配置检查成功，两个经本机 curl --resolve 检查的 HTTPS 页面均 HTTP/2 200；Certbot 与 Nginx 插件 2.9.0 已安装，识别证书 cyb3r.art 有效至 2026-12-19 00:20:38 UTC；Nginx、应用、certbot.timer 均 active | Nginx 站点暂只监听本机；已恢复 `/etc/letsencrypt` 和新增独立站点，原默认站点保留。定时器活动不等于已通过实际续期验证，续期演练待公网切换后完成 |
| 阿里云应用验证 | 用户回传 npm ci 安装 252 项依赖成功、SQLite integrity ok、两个本机 HTTP 页面均为 200，服务 enabled 与 active；沿用生产前端产物 | 首次 curl 在服务启动时拒绝连接，重试后成功；SQLite 实验提示及依赖弃用提示未阻断执行。该结果不包含本机或公网 HTTPS、API 业务流程、图片与真实邮件验收 |
| CI 自动化 | 工作流已扩展为 PR/main CI 与成功 main 的自动发布，使用 Node.js 22.x；新加 Bash 发布边界与失败回退演练 | 本轮尚未运行；需完成一次性安装和 GitHub Secrets/变量后推送，再确认首轮 verify/deploy。此前 CI 修复结果为历史基线，不代表本次流水线验证通过 |
| 本地已完成 | 用户端批量借用（卡片"＋加入借用"、底部浮动清单、批量弹窗一次填写、部分冲突提示）；用户端批量归还（归还页勾选多台 + 统一备注一次归还，备注不同走单台各自归还，全选/清除；勾选进批量的设备其单台备注与"确认归还"置灰，单台归还后同步移除勾选）；管理端批量强制归还（当前借出列表勾选 + 统一备注弹窗；勾选后单台"管理员归还"/"修改借用信息"置灰，单台强制归还后同步移除勾选，批量数量实时准确）；邮件通知（其他设备名称保持干净，待上线提醒单独展示且只出现一次，型号/编号缺失有明确兜底；批量借出/批量用户归还/批量管理员归还各发一封，按借用人分组展示，旧模板自动补充明细并避免多人时只显示第一人；管理员邮件设置的三类正文已直接填入完整模板）；SQLite 运行时（`db/schema.sql`、`db/repository.js`、`scripts/migrate-json-to-sqlite.js`；数据库不存在时从旧 JSON 首次迁移，存在后不再读取或写回 JSON；关键跨表写入使用事务，启用 WAL 和 busy timeout）；用户端体验增强（移除顶部重复的可借数量状态条，保留列表标题旁随筛选变化的数量；增加非阻塞借还反馈、选中态、卡片/详情扫描层和归还列表过渡）；答案之书彩蛋（归还成功通知入口、`/answers` 页面、本地随机答案、结果文案自适应换行、“再抽一次”返回答案页首页和返回借还页；左上角标题为“答案之书”）；单台借用/归还/强制归还与单台邮件保持逐台不变 | 新增接口：`POST /api/records/return-batch`（凭证覆盖所选记录，空/超 10 台 400、凭证失效 403、部分冲突返回 conflicts）、`POST /api/records/force-return-batch`（管理员权限、上限 50 台、只写一条 `admin_returned` 汇总日志）和 `POST /api/records/borrow-other`（写入普通借用记录，不改变库存）；`queueEmailNotification`/`queueBatchEmailNotification`/`formatEmailRecordGroup` 统一正式邮件、测试邮件和新旧模板兼容逻辑；启动时读取到历史简略正文会自动返回完整模板；`migrate:sqlite` 只生成迁移副本，不参与业务读写；本地 `data/email-settings.json` 已直接填入完整三类正文；答案之书不新增 API 或持久化数据；本轮未改生产持久化目录 |
| 本地已验证 | TSX `npx tsc --noEmit --pretty false` 通过；前端定向契约 90/90；Vite 独立输出目录构建通过（仅有既有大体积 chunk 提示）；邮件定向测试 11/11；SQLite 专项测试 3/3，真实本地 JSON 迁移演练完成（分类 7、设备 10、记录 144、日志 48、管理员 2、邮件设置 1；完整性 `ok`、WAL 已启用） | 本轮验证覆盖 Motion 卡片取消悬停/按压整卡缩放、扫描动画移除、TSX 属性和 class 修复；浏览器桌面端与 390px 移动端、邮件管理页预览和真实 SMTP 收件待用户手动验收；标准输出目录构建曾受 Windows `frontend/dist/assets` 文件占用影响，本轮使用 `.vite-build-check` 完成独立构建 |
| 已同步服务器 | 旧机生产备份已传至京东云并恢复到 `/opt/device-management`、`/var/lib/device-management`，恢复环境配置与独立 systemd 服务，使用 `deviceapp` 安装锁定依赖，沿用旧机生产前端产物；已恢复 `/etc/letsencrypt`、新增设备管理 Nginx 本机预检站点并安装 Certbot 与 Nginx 插件 `1.21.0` | 旧机 Node.js `22.23.1`，新机 Ubuntu `22.04.5` x86_64、Node.js `24.14.1`；旧机目录大小为应用 210M、持久化 73M；备份两端 SHA-256 均为 `fc682c4fb8602d3ece4d53f424846415fafe51fac204c49c3ede404a018b73de`。这是试运行副本，正式切换前需再次同步最新数据 |
| 生产已验证 | 用户回传新机 `SQLite integrity: ok`，本机 HTTP `/borrow` 与 `/admin` 均为 200，设备管理服务 `active`；Nginx 配置检查通过，经本机 `curl --resolve` 验证两个 HTTPS 页面均为 `HTTP/2 200`，Nginx `active`；Certbot 识别迁入证书有效 | 证书有效至 2026-12-19 00:20:38 UTC。安装日志显示创建 `certbot.timer` 启用链接，未重启现有服务或容器，但定时器活动状态与应用开机自启仍待确认；本轮未切换 DNS，公网 HTTPS、接入备案、最终同步、真实续期演练及人工业务验收待完成，不标记整站迁移完成 |

## 活跃事项

当前最终目标为新腾讯云 `43.138.146.44`；阿里云的备份位于 `/root/device-migration-20261020-01/migration.tar.gz`，恢复暂存为 `/root/device-migration-restore-20261020-01`；下段旧恢复记录属于京东云中间机。原始备份 SHA-256 为 `fc682c4fb8602d3ece4d53f424846415fafe51fac204c49c3ede404a018b73de`。10 月 20 日用户此前确认旧腾讯云仍可使用，10 月 16 日后无新增借还，最终同步仍需核实旧机最新实际状态。

迁移为当前优先事项。旧机备份位于 `/home/ubuntu/device-migration-20261016-01/migration.tar.gz`；新机备份位于 `/home/l0x0hhh/device-management-migration-20261016-01.tar.gz`，恢复暂存目录为 `/root/device-migration-restore-20261016-01`。备份含业务数据、环境密钥、Git Deploy Key 与可能的证书私钥，需保持限制访问，不提交仓库。新机现有 Nginx 默认站点及多个 Docker 服务需要保留；以下功能迭代验收事项继续保留，迁移完成后接续。

本轮已收敛用户端 Motion 与 CSS 的 transform 竞争，移除设备卡片和详情页的蓝色扫描动画，取消设备卡片悬停/按压整卡缩放，恢复 Motion 详情页的明确卡片底框，并修复设备分类桌面端因 Motion 初始透明状态导致卡片不可见的问题；前端定向契约和 TypeScript 检查已通过，等待用户手动确认详情底框、分类筛选和连续下滚表现。

本轮文档核对确认网页端为 Vue 3 + Vite：页面业务主要在 `frontend/src/main.js`，设备卡片 Motion 动效位于 `frontend/src/components/MotionDeviceCard.tsx`，由 `@vitejs/plugin-vue-jsx` 和 `tsconfig.json` 支持；已同步入口说明与代码地图，未改运行时代码。

本阶段已在管理端首个 Tab 和修改密码弹窗接入 Vue `transition` 进出场动画，并通过 `prefersReducedMotion` 关闭动态效果；曾因模板多余闭合标签导致管理端无法挂载，现已修复。定向前端契约 92/92、TypeScript 检查和 Vite 构建已通过，等待用户进行桌面端与 390px 移动端人工验收。

第二阶段已将同一模式扩展至管理端移动导航抽屉和设备添加/编辑弹窗；期间修复了设备弹窗 transition 结束标签位置错误导致的管理端白屏。前端契约 93/93、TypeScript 检查和 Vite 构建通过，仍需人工确认窄屏打开/关闭与弹窗连续操作体验。

本阶段后续尝试将动画重点转向 `/borrow`，发现运行时模板中的额外 Motion 包装会造成白屏风险，已回退该组包装；当前保留此前已验证的详情、按钮、设备卡片和反馈 Motion 动效。前端契约 93/93、TypeScript 检查和 Vite 构建通过。

已修复设备卡片动画触发不一致：`MotionDeviceCard.tsx` 现在同时设置挂载后的 `animate` 和滚动 `whileInView` 目标，首屏及筛选后的相机/镜头分类不再依赖 IntersectionObserver 是否重新触发；前端契约 93/93、TypeScript 检查和 Vite 构建通过。

## 已知阻塞与边界

- 最终目标已回到腾讯云，原备案接入是否仍有效、新机地域与非经营性服务条件需核对。腾讯云官方说明同一接入商内更换 IP、无需经营性备案时通常不要求重新备案，参见 https://cloud.tencent.com/document/faq/243/19617 。不能仅凭新机同厂商就推断原备案一定有效。原阿里云申请未自动取消；切换前保持旧机服务有效。
- 阿里云证书恢复、本机 HTTPS 和续期定时器 active 已验证，但仅有本机监听，公网网络入口、真实浏览器业务及真实续期演练尚未验证。证书有效至 2026-12-19 00:20:38 UTC；京东云中间机不参与本轮最终切换。
- 备份完成后旧机已恢复写入，因此新机当前副本不代表最新生产数据。最终同步期间必须明确单一写入源，新机正式写入后的回滚需先保全新机数据。
- 浏览器桌面端、390px 移动端、真实 SMTP 收件和复杂管理操作由用户手动验收；Agent 不启动 Playwright、下载浏览器或安装额外依赖。
- 本轮答案之书只提供娱乐性随机文案，不代表设备管理、健康或其他现实决策建议；答案和用户问题均不写入服务器。
- SQLite 生产数据库默认位于 `/var/lib/device-management/data/device-management.sqlite`；服务器同步只更新源码和构建，不覆盖数据库、旧 JSON 备份、上传图片或二维码。
- 生产持久化数据位于服务器 `/var/lib/device-management`；更新不得覆盖 `data/`、`uploads/`、`public/qrcodes/`、`frontend/dist/` 或 `node_modules/`。

## 本轮涉及文件

- CI/CD 本轮修改：`.github/workflows/ci.yml`、`deploy/update-from-git.sh`、`test/ci-workflow.test.js`、`test/sync-skill.test.js`、`DEPLOY.md`、`skills/sync-device-management/SKILL.md`、`docs/CURRENT_STATUS.md`、`docs/PROJECT_GUIDE.md`、`docs/CODE_STRUCTURE.md`、`docs/CHANGELOG.md`；新增 `.gitattributes`、`deploy/setup-cd.sh`、`docs/CI_CD.md`。新增代码前均有简注释，未改业务源码或生产数据；本地未执行测试/构建，尚未远程部署。

### 既有功能迭代文件

- 已改：`.github/workflows/ci.yml`、`test/ci-workflow.test.js`、`server.js`、`db/repository.js`、`frontend/src/main.js`、`frontend/index.html`、本地忽略配置 `data/email-settings.json`、`db/schema.sql`、`scripts/migrate-json-to-sqlite.js`、`package.json`、`public/assets/answer-book.png`、`public/assets/answer-book-icon.png`、`public/assets/answer-book-loading.json`、`public/assets/answer-book.ttf`、`public/assets/dotlottie-player.mjs` 及其本地渲染模块、`test/server.test.js`、`test/frontend-source.test.js`、`test/email-notification.test.js`、`test/database.test.js`、`docs/CURRENT_STATUS.md`、`docs/PROJECT_GUIDE.md`、`docs/CODE_STRUCTURE.md`、`docs/CHANGELOG.md`
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

### 最新上线进度（2026-10-20 晚）

用户从本机 PowerShell 使用 curl.exe --resolve 指向新腾讯云 43.138.146.44，/borrow 与 /admin 均返回 HTTP/1.1 200，Nginx 1.28.3，未使用跳过证书验证参数。确认公网 HTTPS 页面入口通过；不代表登录、借还、邮件或实际 DNS 已切换。下一步进入短暂停机窗口，停止两边应用，从旧机生成最新持久化目录和环境配置快照并传输，验证后恢复新机；用户已回传最终快照两端相同 SHA-256：ded21b51a47786f33493f9d676866c030ceebf9876695a5325ca7103326c9f6f；快照已传至新机 /home/ubuntu/device-final-20261020-01/final-data.tar.gz。用户随后回传域名 A 记录为 43.138.146.44，直接访问 https://cyb3r.art/borrow 返回 HTTP/1.1 200（Nginx 1.28.3），确认域名公网切换成功。最终恢复脚本末尾输出未单独回传；Certbot renew --dry-run 全部模拟续期成功，device-management、nginx、certbot.timer 均 enabled 且 active；管理员登录、真实借还、图片二维码和邮件仍待用户人工验收。
