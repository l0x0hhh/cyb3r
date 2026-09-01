# 设备管理项目交接卡

> 最后更新：2026-09-01
> 这是新会话的第一入口；稳定规则见 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)，历史变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 当前目标

保持学院设备借还系统可维护、可安全部署；批量借用、批量归还与批量邮件汇总已完成本地验证、远端推送、服务器同步和生产验证；本轮用户端借还页体验增强已完成本地实现与验证。

## 第一待办

用户端借还页体验增强已完成本地实现与验证并推送到 GitHub；服务器同步因 SSH 登录认证未完成，生产验证待完成。

## 状态快照

| 状态面 | 当前结论 | 证据或备注 |
| --- | --- | --- |
| 本地已完成 | 用户端批量借用（卡片"＋加入借用"、底部浮动清单、批量弹窗一次填写、部分冲突提示）；用户端批量归还（归还页勾选多台 + 统一备注一次归还，备注不同走单台各自归还，全选/清除；勾选进批量的设备其单台备注与"确认归还"置灰，单台归还后同步移除勾选）；管理端批量强制归还（当前借出列表勾选 + 统一备注弹窗；勾选后单台"管理员归还"/"修改借用信息"置灰，单台强制归还后同步移除勾选，批量数量实时准确）；批量事件邮件汇总（批量借出/批量用户归还/批量管理员归还各一封，`{{deviceName}}`/`{{deviceModel}}`/`{{deviceId}}` 批量时自动渲染为顿号分隔完整清单，不新增模板变量，旧模板直接兼容）；用户端体验增强（移除顶部重复的可借数量状态条，保留列表标题旁随筛选变化的数量；增加非阻塞借还反馈、选中态、卡片/详情扫描层和归还列表过渡）；单台借用/归还/强制归还与单台邮件保持逐台不变 | 新增接口：`POST /api/records/return-batch`（凭证覆盖所选记录，空/超 10 台 400、凭证失效 403、部分冲突返回 conflicts）与 `POST /api/records/force-return-batch`（管理员权限、上限 50 台、只写一条 `admin_returned` 汇总日志）；`queueBatchEmailNotification` 汇总发送并列表化既有设备字段；本轮未改后端、管理端、小程序和持久化目录 |
| 本地已验证 | 完整 `npm test` 173/173；`node --check frontend/src/main.js` 通过；标准 `npm run build` 通过（仅保留既有大体积 chunk 提示） | 覆盖：批量归还成功/部分冲突/参数校验/凭证失效、管理员批量归还只追加一条汇总日志且无隐私、批量三类事件各只发一封且名称/型号/编号逐条保留、单台归还/强制归还后勾选同步移除、勾选后单台操作置灰、前端互动反馈清理、顶部数量去重与列表筛选计数保留 |
| 已同步服务器 | GitHub `main` 已推送到 `7f8c507`；服务器运行版本仍为 `84d3fe0`，本轮尚未同步 | 已尝试执行 `sudo bash /opt/device-management/deploy/update-from-git.sh`，但 SSH 返回 `Permission denied (publickey,password)`；生产持久化目录未纳入更新 |
| 生产已验证 | 上一版本既有功能与批量借还、批量邮件汇总及重复名称/型号清单修复已生产确认；本轮用户端体验增强尚未生产验证 | 待在具备服务器登录权限的终端执行同步并完成构建、服务检查和浏览器验证 |

## 活跃事项

本轮本地浏览器视觉复核和 GitHub 推送已完成；服务器同步待 SSH 登录认证，之后再记录构建、服务和生产验证状态。

## 已知阻塞与边界

- 浏览器桌面端、390px 移动端、真实 SMTP 收件和复杂管理操作由用户手动验收；Agent 不启动 Playwright、下载浏览器或安装额外依赖。
- 生产持久化数据位于服务器 `/var/lib/device-management`；更新不得覆盖 `data/`、`uploads/`、`public/qrcodes/`、`frontend/dist/` 或 `node_modules/`。

## 本轮涉及文件

- 已改：`server.js`、`frontend/src/main.js`、`frontend/index.html`、`test/server.test.js`、`test/email-notification.test.js`、`test/frontend-source.test.js`、`test/security-config.test.js`、`docs/`（含本卡、`PROJECT_GUIDE.md` 与 `CHANGELOG.md`）
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
