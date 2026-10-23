# 设备管理项目交接卡

> 最后更新：2026-10-23。当前事实以本卡为准；稳定规则见 PROJECT_GUIDE.md。

## 当前目标

三个窗口已交付本地提交，主窗口按 C → B → A 合入独立整合分支 codex/integrate-refactor。代码已在当前主目录，可供用户本地人工验收；没有推送此分支、更新 main 或部署生产。

## 第一待办

用户在当前主目录检查整合版借还、管理、答案页面。先退出其他工作树启动的本地服务，两个终端分别执行 npm.cmd run dev、npm.cmd run dev:frontend，打开 Vite 输出的 Local 地址加 /borrow、/admin、/answers。不要用已有 frontend/dist 判断本次前端改动是否生效。

验收后按用户授权统一推送 main，现有 CI 执行类型检查、完整测试和构建，再经 CD 发布精确 SHA。当前分支尚无本批 CI 结果，不能用字体发布的成功代替重构验证。

## 状态快照

| 状态面 | 当前结论 | 证据与边界 |
| --- | --- | --- |
| 本地完成 A | 三页面、API、粒子加载、页脚和日期拆分 | 原提交 1c6fee8 → 整合 ac7cf7f；跳过与线上字体等价的 b159cf9 快照 |
| 本地完成 B | 14 个借还记录接口迁至 routes/service，权限与凭证独立 | 原提交 46ce5e7 → 整合 79f5ee5；设备/分类/账号/邮件配置等仍在 server.js |
| 本地完成 C | 记录完整快照按行差异写入，保留数组顺序和事务 | 原提交 e8c4f4b → 整合 46da583；仓储五个公共成员、schema、迁移和依赖不变 |
| 本地整合 | 共享文档冲突已统一，源码没有合并冲突 | 交付详见 docs/tasks/refactor-integration.md；主目录原 AGENTS.md 与其他 worktree 未改 |
| 本地验证 | 已阅读差异、核对边界与字体基线，执行静态差异检查 | 未运行项目语法/类型检查、测试、构建、服务或浏览器自动化；本批人工验收待反馈 |
| 服务器同步 | 本批未推送、未部署；线上仍为字体提交 764ffb09fc324dc29058060df02b39b53c7a418d | 历史 Actions 39951398350 verify/deploy success，服务器日志 2026-10-23 20:11:50 |
| 生产验证 | 字体发布健康检查已成功；重构没有生产验证 | 不能把旧 CI 或无合并冲突当作当前行为通过 |

## 本批边界与验收重点

- 前端 main.js 仅装配入口，页面仍用 Vue 运行时模板；AdminPage 本身仍较大，不表示完成所有组件化或全面类型迁移。
- 后端记录服务注入唯一仓储、原邮件队列和共享函数，不启动第二个服务；6 个公共接口共用原限流器，8 个管理接口检查 records 权限。
- 仓储仍同步接收完整快照，缺失 ID 删除、空数组清空；记录保留输入顺序，不变行跳过 DML。仍全量读取比较，没有性能基准或吞吐提升证明。
- 验收单台/批量借还、部分成功后的清单与表单保留、其他设备、管理员强制归还/归档恢复、权限脱敏、图片和工作簿、邮件及答案字体。不要对生产数据做回归测试。
- 基线的内存会话/归还凭证、批量凭证消费时点、邮件无持久化重试队列保持；本批不夹带业务修正。

## 分支与交付

- 整合分支 codex/integrate-refactor 位于 E:/AIstudy/设备管理；main 仍指向已上线字体 764ffb0。
- A codex/frontend-pages，B codex/backend-services，C codex/sqlite-repository 保留各自提交和工作树；没有删除或归档其他窗口成果。
- 新旧文件职责见 PROJECT_GUIDE.md 和 CODE_STRUCTURE.md；各窗口原始交付在 docs/tasks/，统一报告为 refactor-integration.md。
- 本轮同步维护 CURRENT_STATUS.md、PROJECT_GUIDE.md、CODE_STRUCTURE.md、REFACTOR_TASKS.md、CHANGELOG.md 与统一报告。源码仅合入窗口提交，未额外改写业务。

## 生产与同步边界

- 腾讯云 43.138.146.44；服务 device-management；应用 /opt/device-management；用户 deviceapp。
- 持久化 /var/lib/device-management/{data,uploads,qrcodes}，环境 /etc/device-management.env；发布不得覆盖数据或密钥。
- 前端页面与 API 模块、server.js 与 backend/、db/repository.js 必须作为同一版本；无依赖或 schema 变化。现有自动发布仍安装锁定依赖、构建、切换并重启一次。
- 发布前按 skills/sync-device-management/SKILL.md 和 docs/CI_CD.md 分类、检查 CI/CD；不在运行中的生产 3000 端口执行测试。

## 新会话接续

先读本卡，再读 PROJECT_GUIDE.md，处理第一待办。先确认当前分支和用户本地验收反馈，不自行推断整合分支已部署；不运行用户禁止的本地测试/构建或浏览器自动化。
