# 多窗口重构任务说明

> 基线：生产已确认发布 `99d65b1`。当前窗口正处理答案之书字体压缩和提前加载，尚未提交发布。

## 协作方式

每个窗口使用独立 Git worktree（各自的代码目录）和 `codex/` 分支。本窗口负责字体与最终整合，其他窗口完成自己的提交后交付分支和 SHA，不推送 main，不部署生产。

| 窗口 | 工作范围 | 建议分支 | 开始时机 |
| --- | --- | --- | --- |
| 当前窗口 | 答案之书字体、预加载、任务划分、最终整合 | 当前工作区 | 正在处理 |
| A | 前端页面与 API 拆分，公共前端入口由这一窗口统一修改 | codex/frontend-pages | 字体修复提交形成共同基线后开始 |
| B | 后端路由、业务与权限的职责拆分 | codex/backend-services | 可从已提交的 99d65b1 开始，与 C 并行 |
| C | SQLite 仓储内部写入优化，保留对外接口和数据兼容 | codex/sqlite-repository | 可从已提交的 99d65b1 开始，与 B 并行 |

前端页面拆分与前端 API 拆分放在 A 的一个任务内，因为二者会同时修改 main.js。B 与 C 以固定仓储接口协作：`createSqliteStore` 返回 `databasePath/readCollection/writeCollection/transaction/close`，同步调用、完整快照写入语义不变。

各窗口先读交接卡和项目导航，汇报预计文件，再在任务范围内改动。遵守用户不运行本地类型检查、测试或构建的要求；页面由用户人工检查，不安装或运行浏览器自动化。改动文件开头保留简短注释，不碰生产数据、密钥、构建产物和用户既有 AGENTS.md 改动。

各分支照常更新项目文档，另在 `docs/tasks/<任务名>.md` 写本任务交付。共享文档在整合时统一重写当前状态，避免相互覆盖事实。

## 窗口 A：可直接复制的任务

```text
请在独立 worktree、codex/frontend-pages 分支，实施设备管理项目前端页面和 API 边界重构。先读 docs/CURRENT_STATUS.md、docs/PROJECT_GUIDE.md，再汇报预计改动文件。开始代码改动前确认基线已经包含当前字体修复；若没有，先给拆分方案并说明缺少的基线，不覆盖当前窗口尚未提交的代码。

你可以修改本任务所需前端代码及对应检查、文档。将 BorrowPage、AdminPage、AnswersPage 逐步拆到 frontend/src/pages/，将 apiCall 与共享页脚/时间等工具放到合适的 services/composables；main.js 只保留应用装配与入口选择。保留 Vue 运行时模板、现有路由和页面效果，不新增框架，不引入业务规则变化。

保持答案文本 content/answer-book-responses.json、字体 content/answer-book-font.js 和 use-answer-font.js 的配套关系；若移动这些文件，同步生成脚本、字体检查和引用。保留用户信息脱敏、批量部分成功、表单保留、动画/裁剪和减少动态效果行为。

主要文件边界是 frontend/、test/frontend-source.test.js、test/build-config.test.js 及必要的前端专项检查。不改 server.js、db/、deploy/ 或依赖版本；接口调用的 URL、请求体、响应与认证头保持不变。源码检查因拆文件失效时调整定位，不删除行为要求。

按用户约束不在本地运行类型检查、测试、构建或浏览器自动化。代码首部加简短注释，更新项目文档与 docs/tasks/frontend-pages.md。完成本任务后只创建本地提交，交付分支、SHA、修改文件、兼容边界及未验证项，不推送 main 或部署。
```

## 窗口 B：可直接复制的任务

```text
请在独立 worktree、codex/backend-services 分支，从已提交的 99d65b1 或包含它的确认基线实施后端分层。先读 docs/CURRENT_STATUS.md、docs/PROJECT_GUIDE.md，按接口锚点读取 server.js，再汇报预计文件。你可以修改本任务后端代码及对应检查和文档。

分批将 Express 路由、业务处理、校验和权限中间件拆到 backend/，让 server.js 逐步成为启动装配入口。先选一个完整业务域形成可复用模式，交付明确已完成范围，不要求一次搬完全部接口。保持 CommonJS、现有 API 路径/状态码/响应字段/错误行为、会话与权限、脱敏、限流、事务边界、设备上下线限制和邮件规则。

仓储接口冻结：继续使用 createSqliteStore 的 databasePath/readCollection/writeCollection/transaction/close，不改签名、同步行为或完整快照语义，以便数据库窗口并行。通过依赖传入仓储和邮件服务，避免新模块导入 server.js 启动第二个服务。

允许修改 server.js、新 backend/ 模块和对应后端/安全/邮件检查及文档；不改 frontend/、db/、db/schema.sql、数据迁移脚本、deploy/ 或依赖版本。不读写真实生产数据，不改变持久化目录。拆文件后调整源码检查的定位，保留权限、隐私和事务的行为断言。

按用户要求不在本地运行类型检查、测试或构建，不启动生产或自动浏览器。首部简短注释并更新项目文档及 docs/tasks/backend-services.md。完成后只做本地提交，交付分支、SHA、文件、已拆业务域与未验证项，不推送 main 或部署。
```

## 窗口 C：可直接复制的任务

```text
请在独立 worktree、codex/sqlite-repository 分支，从已提交的 99d65b1 或包含它的确认基线，处理 SQLite 仓储内部写入效率。先读 docs/CURRENT_STATUS.md、docs/PROJECT_GUIDE.md、db/repository.js 与 db/schema.sql，汇报预计文件和兼容方案后再改动。你可以修改本任务内部实现及对应检查、文档。

先选设备或记录中的一个集合，将每次整表删除再写回改为识别新增、修改、删除的差异写入，避免无变化行反复落盘。writeCollection 仍接收完整集合，移除缺失 ID 的语义不变；保留 JSON 字段适配、旧字段兜底、事务/嵌套事务、异常回滚、WAL 和关闭行为。不要把已存在的空值、排序或归档行为改掉。

必须保留 createSqliteStore 对外的 databasePath/readCollection/writeCollection/transaction/close，同步签名和完整快照语义不变。不得修改 server.js、frontend/、email-service.js、db/schema.sql、迁移脚本、deploy/ 或依赖版本。schema/新索引/接口级定向查询若有建议，写入后续方案，留整合后单独安排，不在本批实施。

主要文件是 db/repository.js、必要的新 db/ 内部模块、test/database.test.js 或独立仓储检查。补充有意义的无变化写入、增删改及失败回滚检查，不依赖真实数据库，不运行本地检查/测试/构建。首部加简短注释，更新文档及 docs/tasks/sqlite-repository.md。

完成一个集合的兼容优化后只做本地提交，交付分支、SHA、完整快照兼容说明、预期写入变化和未验证项。不要推送 main 或操作生产。性能若未实测，明确写预期收益，不宣称已经提升多少倍。
```

## 整合顺序

1. 当前字体修复先经用户检查并形成提交，A 从该版本开始；B/C 可先在各自工作树进行上述独立工作。
2. 整合 C、再整合 B，保持冻结接口并核对事务与行为兼容；A 在同一最终分支合入。前端与后端工作树不互相复制运行时数据。
3. 主窗口统一处理共享文档和冲突，查看完整文件清单与差异，不使用整目录覆盖或强制推送。
4. 用户确认后推送 main，让现有 CI 统一执行类型检查、完整测试和构建，再由 CD 按 SHA 发布。各窗口不得自行部署。

文档提供任务说明，没有自动创建其他窗口、工作树或执行上述分支任务。
