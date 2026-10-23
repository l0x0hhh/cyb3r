# 设备管理项目交接卡

> 最后更新：2026-10-23。当前事实以本卡为准；稳定规则见 PROJECT_GUIDE.md。

## 当前目标

三个窗口按 C → B → A 整合后，经用户授权快进 main 发布。首轮源码计数误匹配修正后，3fa1bbea222add7f911604aa6aa79af1dcaf049d 已上线；Actions 39956277288 类型检查、249 项测试、构建与部署全部成功。服务器日志确认北京时间 20:50:34 发布该 SHA，保留上一版 764ffb0，未回退业务数据库。

## 第一待办

用户反馈腾讯云已升级 Node，实际补丁版本、服务重启及健康状态尚无命令输出核对。用户要求更新 GitHub Actions，本地已将 checkout/setup-node 从 v4 更新至官方 v7（Action Node 24 运行时）；项目保持 22.x，新增 check-latest: true 核对最新补丁，避免旧工具缓存。准备提交推送并查看本批 CI/CD；不修改 package.json 或生产系统包。

官方依据：https://nodejs.org/en/blog/vulnerability/october-2026-security-releases 。公告列出 22.23.4、24.22.1、26.12.1；Brotli 越界写 CVE-2026-111497 为 high，另含 DNS/TLS、依赖等修复。回归提交 https://github.com/nodejs/node/commit/0392385841 ，底层修复 https://github.com/nodejs/node/commit/a6040b50d9 。仅阅读，未在生产运行无效压缩输入或漏洞测试。项目源码未发现直接 Brotli 调用不代表依赖链不可触达，尚未完成暴露路径审计。

本批仅修改 .github/workflows/ci.yml、docs/CI_CD.md、本卡及 CHANGELOG.md。未运行本地测试/构建；工作流实际兼容性等待本次 GitHub Actions，不能用 3fa1bbe 的历史 CI 替代。生产 Node 包及运行进程版本确认与 Action 插件更新分开记录。

用户刷新生产 /borrow、/admin、/answers，确认借还、管理和答案页面效果。自动健康检查已通过，不能代替桌面/手机、权限、借还和邮件的人工验收。

首轮误匹配只修正 test/security-config.test.js 的路由注册计数，未改变业务或削弱六条公共路由限流要求。Agent 未运行本地测试或构建；全部自动验证在 GitHub Actions 临时运行器完成。

## 状态快照

| 状态面 | 当前结论 | 证据与边界 |
| --- | --- | --- |
| 本地完成 A | 三页面、API、粒子加载、页脚和日期拆分 | 原提交 1c6fee8 → 整合 ac7cf7f；跳过与线上字体等价的 b159cf9 快照 |
| 本地完成 B | 14 个借还记录接口迁至 routes/service，权限与凭证独立 | 原提交 46ce5e7 → 整合 79f5ee5；设备/分类/账号/邮件配置等仍在 server.js |
| 本地完成 C | 记录完整快照按行差异写入，保留数组顺序和事务 | 原提交 e8c4f4b → 整合 46da583；仓储五个公共成员、schema、迁移和依赖不变 |
| 本地整合 | 共享文档冲突已统一，源码没有合并冲突 | 交付详见 docs/tasks/refactor-integration.md；主目录原 AGENTS.md 与其他 worktree 未改 |
| 本地验证 | 差异、边界、引用和字体基线静态核对 | Agent 未运行本地项目检查/测试/构建、服务或自动浏览器 |
| CI 验证 | 语法/类型、249 项测试、前端构建通过 | Actions 39956277288，verify 120422794591 success |
| 服务器同步 | 3fa1bbea222add7f911604aa6aa79af1dcaf049d 已上线 | deploy 120423006895 success，日志 2026-10-23 20:50:34 完成发布 |
| 生产验证 | 发布健康检查通过，上一版保留，未回退业务数据库 | 用户生产页面与完整业务人工验收待反馈 |

## 本批边界与验收重点

- 前端 main.js 仅装配入口，页面仍用 Vue 运行时模板；AdminPage 本身仍较大，不表示完成所有组件化或全面类型迁移。
- 后端记录服务注入唯一仓储、原邮件队列和共享函数，不启动第二个服务；6 个公共接口共用原限流器，8 个管理接口检查 records 权限。
- 仓储仍同步接收完整快照，缺失 ID 删除、空数组清空；记录保留输入顺序，不变行跳过 DML。仍全量读取比较，没有性能基准或吞吐提升证明。
- 验收单台/批量借还、部分成功后的清单与表单保留、其他设备、管理员强制归还/归档恢复、权限脱敏、图片和工作簿、邮件及答案字体。不要对生产数据做回归测试。
- 基线的内存会话/归还凭证、批量凭证消费时点、邮件无持久化重试队列保持；本批不夹带业务修正。

## 分支与交付

- 当前主目录已切回 main，指向已上线 3fa1bbe；codex/integrate-refactor 保留 5f95c4d 整合检查点。源码计数修正在 main 单独提交。
- A codex/frontend-pages，B codex/backend-services，C codex/sqlite-repository 保留各自提交和工作树；没有删除或归档其他窗口成果。
- 新旧文件职责见 PROJECT_GUIDE.md 和 CODE_STRUCTURE.md；各窗口原始交付在 docs/tasks/，统一报告为 refactor-integration.md。
- 本轮同步维护 CURRENT_STATUS.md、PROJECT_GUIDE.md、CODE_STRUCTURE.md、REFACTOR_TASKS.md、CHANGELOG.md 与统一报告。源码仅合入窗口提交，未额外改写业务。

## 生产与同步边界

- 腾讯云 43.138.146.44；服务 device-management；应用 /opt/device-management；用户 deviceapp。
- 持久化 /var/lib/device-management/{data,uploads,qrcodes}，环境 /etc/device-management.env；发布不得覆盖数据或密钥。
- 前端页面与 API 模块、server.js 与 backend/、db/repository.js 必须作为同一版本；无依赖或 schema 变化。现有自动发布仍安装锁定依赖、构建、切换并重启一次。
- 发布前按 skills/sync-device-management/SKILL.md 和 docs/CI_CD.md 分类、检查 CI/CD；不在运行中的生产 3000 端口执行测试。
- 发布记录：https://github.com/l0x0hhh/cyb3r/actions/runs/39956277288 。发布后的结果文档仅在本地更新，下次正常提交带入，不为记录元数据再次触发部署。

## 新会话接续

先读本卡，再读 PROJECT_GUIDE.md，处理第一待办。先确认当前分支和用户本地验收反馈，不自行推断整合分支已部署；不运行用户禁止的本地测试/构建或浏览器自动化。
