# 后端分层第一批交付（窗口 B）

> 日期：2026-10-23。分支：`codex/backend-services`。基线：`99d65b1012020eae98613652d72e10e871c27a81`。
> worktree：`E:\AIstudy\设备管理\.worktrees\backend-services`。只做本地提交；最终 SHA 见交付消息或 `git log -1 codex/backend-services`。

## 已完成业务域

完整借还记录域 `/api/records`，保持 CommonJS。server.js 装配单例依赖，路由只接 HTTP/执行原中间件，服务接收普通参数并返回 `{ status, body }`，可供后续业务域复用。

| HTTP | 完整路径 | 服务方法 | 边界 |
| --- | --- | --- | --- |
| POST | /api/records/borrow | borrow | 公共，共用原借还限流器 |
| POST | /api/records/borrow-other | borrowOther | 公共，只写记录 |
| POST | /api/records/borrow-batch | borrowBatch | 公共，最多 10 台、部分成功 |
| POST | /api/records/return-lookup | lookupReturns | 公共，本人匹配与 10 分钟凭证 |
| POST | /api/records/return | returnOne | 公共，凭证验证 |
| POST | /api/records/return-batch | returnBatch | 公共，最多 10 条、部分成功 |
| GET | /api/records | list | records 权限，归档查询参数原样保留 |
| GET | /api/records/active | listActive | records 权限 |
| PUT | /api/records/:id | update | records 权限 |
| POST | /api/records/:id/force-return | forceReturn | records 权限 |
| POST | /api/records/force-return-batch | forceReturnBatch | records 权限，最多 50 条 |
| DELETE | /api/records/:id | archive | records 权限，必须先归还 |
| POST | /api/records/:id/restore | restore | records 权限 |
| DELETE | /api/records/:id/permanent | removePermanently | records 权限，必须先归档 |

## 修改文件

运行时共 6 个文件：

- server.js：引用新模块、注入唯一 DATA_STORE/原邮件队列/日志与设备共享函数、挂载 records 路由；移出记录业务、手机号/字段兼容、凭证和权限函数。
- backend/records/routes.js：14 个路径、中间件、请求参数与响应映射。
- backend/records/service.js：同步业务、原校验顺序、快照读写和事务；不接 Express req/res。
- backend/records/validation.js：normalizePhone、isFullPhone、getRecordMajor、getRecordPurpose、withRecordCompatibility。
- backend/records/return-authorization.js：独立实例、随机令牌、10 分钟到期与删除。
- backend/middleware/admin-permissions.js：checkAdmin、requireAdminPermission、requireSuperAdmin，注入实时账号查询。

检查共 2 个文件：test/backend-records.test.js（新增），test/security-config.test.js（按模块定位并保留原安全断言）。原 test/server.test.js、test/database.test.js、test/email-notification.test.js 的行为断言无需改路径，全部保留。

文档共 5 个文件：docs/CURRENT_STATUS.md、docs/PROJECT_GUIDE.md、docs/CODE_STRUCTURE.md、docs/CHANGELOG.md、docs/tasks/backend-services.md。

## 保留契约

- createSqliteStore 的 databasePath/readCollection/writeCollection/transaction/close 不改名、不改签名，继续同步、完整快照读写；没有 await、定向数据库写入或第二个连接。
- API 路径、状态码、JSON 字段和错误文案保留，尤其不统一原 catch 中 HTTP 200 与 500 的差异。
- 会话存储与 8 小时有效期仍在 server.js；所有未拆管理接口也复用同一权限工厂，普通管理员白名单、失效账号、超级管理员规则不变。
- 公共接口不增加 records 管理权限，6 个接口仍使用同一个 15 分钟/60 次限流器。公共完整个人信息枚举仍被拒绝，归还查询输出原最小字段；公共设备借用人脱敏仍由原函数处理。
- 单台借还、批量借还及管理员归还的设备/记录/日志事务保持原次序，管理员批量只写一条汇总日志；借用离线或已借出设备仍拒绝。
- 基线批量用户归还在循环内消费凭证、单台在提交后消费；事务失败下的差异显式保留，有专门断言，后续若需修正须另行立项。
- 邮件仍在记录写入/事务提交后进入原队列；单台一封、批量一封汇总、事件类型与 SMTP 失败不回滚业务的规则保持。配置加密、隐私模板与邮件实现未移动或改写。
- frontend/、db/、db/schema.sql、迁移、deploy/、依赖版本、持久化目录和生产数据均未修改。

## 检查与未验证

仅阅读源码、Git 差异和文件范围，运行源码同步分类脚本；这不是自动行为验证。按用户要求未运行 node --check、类型检查、测试或构建；没有安装依赖、启动服务、访问生产、真实 SMTP 或自动浏览器。

新增检查待后续运行：同步快照写入与记录失败回滚、库存状态与无效输入、批量去重/冲突/邮件顺序、本人凭证字段隐私/逐条消费/过期/实例隔离、其他设备不改库存、管理员汇总日志及日志失败回滚、归档恢复删除、权限实时失效、14 个路由的参数/权限/限流映射、模块无启动副作用。安全源码检查直接读取新权限与路由模块，未拼接源码掩盖遗漏。

仍需整合后验证既有 API/数据库/安全/邮件集成检查、实际 HTTP 路由匹配、SMTP 发送失败后的业务成功响应，以及用户手动桌面/手机借还和管理流程；未执行不能宣称通过。

## 尚未拆分

设备与分类、上下线/删除确认、上传/二维码、统计/日志读取、管理员登录/账户/会话、邮件配置/加密/模板/实际投递仍留 server.js。server.js 本批逐步减少职责，还不是纯启动入口。

## 整合与同步方案（仅说明，未执行）

1. 主窗口先整合 C 仓储分支，再整合本 B 分支，随后合入 A 前端分支；以冻结仓储接口核对兼容，不整目录覆盖。
2. 本分支共享文档源于 99d65b1，整合时需要人工保留主窗口更新的字体资源与最新状态，统一改写交接卡并合并短历史。
3. 本轮不推送 main、不创建远端发布。主窗口后续获得授权再按既有 CI/CD 推送整合提交，确认 verify 的语法/类型/串行完整测试/构建以及 deploy 的精确 SHA、健康检查结果。
4. 按项目 sync-device-management Skill：运行时必须把 server.js 与五个 backend/ 模块作为同一版本发布；新增 require 仅指向本地模块和现有 express/内置 crypto，无新增依赖。源码分类结果为后端变更、需重启；手动后备无须 npm ci/前端构建。现有自动发布每次仍以 deviceapp 执行锁定依赖安装和构建，然后切换、重启一次，不能删减发布入口固定步骤。
5. 本轮检查与文档不影响服务器运行。不得将 data/、uploads/、public/qrcodes/、frontend/dist/、node_modules/ 或密钥上传作为增量源码，不触碰 /var/lib/device-management 持久化目录。
6. 未来生产验证由整合窗口按 Skill 检查 /borrow、/admin、/api/categories 的健康状态，并安排人工权限/脱敏/借还/邮件验收；当前全未执行。重启后原内存会话与归还凭证失效的既有规则保留。
