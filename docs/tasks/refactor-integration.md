# 三窗口重构整合交付

日期：2026-10-23；目录 E:/AIstudy/设备管理；分支 codex/integrate-refactor。本批仅本地整合，没有推送或部署。

## 整合来源

| 顺序 | 原提交 | 整合提交 | 范围 |
| --- | --- | --- | --- |
| C | e8c4f4b | 46da583 | 记录集合完整快照差异写入 |
| B | 46ce5e7 | 79f5ee5 | 14 个记录接口、服务、权限和凭证 |
| A | 1c6fee8 | ac7cf7f | 三页面、API、页脚与日期工具 |

从已上线字体版 764ffb0 建整合分支，先用 e8f23d1 保存原有发布结果文档。A 的 b159cf9 是字体快照，经 Git 静态比较，frontend/public/scripts/test 与当前字体版相同，只合入后续重构提交。

三个源码提交没有合并冲突；共享说明书冲突由主窗口保留字体发布证据后统一处理。各窗口原交付仍保留历史范围和未验证项，当前整合事实以本报告及 CURRENT_STATUS 为准。

用户原 AGENTS.md 修改不纳入提交；.worktrees/ 不纳入仓库。原分支和工作树保留，不删除或覆盖其他窗口未提交内容；只整合已提交成果。

## 运行时代码清单

- db/repository.js、server.js。
- backend/middleware/admin-permissions.js。
- backend/records/routes.js、service.js、validation.js、return-authorization.js。
- frontend/src/main.js。
- frontend/src/pages/BorrowPage.js、AdminPage.js、AnswersPage.js。
- frontend/src/services/api.js、borrow-fireworks.js。
- frontend/src/composables/use-site-footer.js。
- frontend/src/utils/date.js。

检查文件：新增 test/backend-records.test.js、test/sqlite-repository.test.js、test/frontend-api.test.js；调整 test/frontend-source.test.js、test/build-config.test.js、test/security-config.test.js。原 API/数据库/邮件行为检查保留。

文档：CURRENT_STATUS.md、PROJECT_GUIDE.md、CODE_STRUCTURE.md、CHANGELOG.md、REFACTOR_TASKS.md，三个原 docs/tasks/ 交付与本报告。未改依赖、schema、迁移、部署入口、已上线字体资源或生产数据。

## 兼容边界与未验证项

页面继续原运行时模板、路径和业务状态；共享 API 保留会话头、JSON/FormData 和原响应语义。records 路由在原会话后挂载，公共与管理权限区分不变；服务通过注入使用同一个仓储和原邮件队列。仓储五个公开成员及同步完整快照语义保留。

记录差异比较保留字段转换、缺失 ID 删除及输入顺序。仍全量读取比较，重排可能更新必要后缀；没有性能基准，不宣称吞吐提升。原批量归还凭证消费时点及邮件无持久化重试行为保留，本批不夹带业务修正。

字体文案、元数据、预加载器、HTML 与 WOFF 保持已上线版本。当前是模块化单体第一轮分层；AdminPage 仍大，server.js 仍有设备/分类/账号/邮件配置等业务，不代表所有架构治理完成。

已做源码阅读、差异、文件边界、引用和静态差异检查。静态提取的前端 44 处 API 方法/地址与字体版一致；新增模块无缺失的相对引用，无残留冲突标记。没有运行项目语法/类型检查、测试、构建、应用服务、浏览器自动化或性能基准。无合并冲突不等于行为验证通过；本批 CI 与人工验收待执行。

## 本地验收

先退出其他 worktree 启动的本地进程。在当前主目录开两个终端，分别执行 npm.cmd run dev 和 npm.cmd run dev:frontend，使用 Vite 输出的 Local 地址。不要用旧 frontend/dist 判断本次效果。

1. /borrow：列表、筛选、图片/裁剪、详情、单借和其他设备；批量部分成功、失败重试及表单保留。
2. 归还：本人查询、单/批量归还、冲突和答案入口；管理端强制归还、归档、恢复和永久删除确认。
3. /admin：登录/退出、权限、分类/上下线限制、图片、工作簿和邮件配置。邮件仅在明确配置的安全本地环境验收。
4. /answers：首次字体、长答案、抽取、分享和返回；页脚、一言、粒子与减少动态效果。
5. 桌面和手机各检查一次。使用合成数据，不对生产记录做回归测试。

## 后续发布

用户验收并授权后，正常合入 main 并推送，不强制推送。现有 CI 统一执行类型检查、完整测试和构建，成功后 CD 发布精确 SHA；不能以字体版历史 CI 代替本批证据。

按 sync-device-management Skill，全部新增前端模块、server.js/backend/ 与 db/repository.js 作为同一版本。无依赖变化；现有自动发布仍以 deviceapp 安装锁定依赖、构建独立版本、切换并重启一次，不重装 CD 入口或变更 Nginx/证书。

不上传 data/、uploads/、public/qrcodes/、frontend/dist/、node_modules/、密钥或环境文件作为增量源码。代码回退不回退数据库。发布后单独核对 CI/deploy 日志及线上 /borrow、/admin、/answers 的用户反馈。
