# 前端页面与 API 边界重构交付

日期：2026-10-23；分支：codex/frontend-pages。仅本地交付，不推送 main 或部署。

## 基线与工作区隔离

- 初始已提交基线：99d65b1012020eae98613652d72e10e871c27a81，缺少当前字体修复。
- 用户同意继续后，在独立 worktree 保存字体快照提交 b159cf983fd4e1fe2edd59a1b8fbc6b52272f854，再进行本任务重构。
- 字体快照包含原窗口现有字体文案/元数据、预加载器、WOFF、HTML/main 接线、生成脚本、字体检查及对应说明书；没有夹带 AGENTS.md。
- 原窗口的文件与暂存区均保留；没有 stash、reset、checkout 或提交原窗口。Git 分支和 worktree 元数据为共享 Git 的正常新增。
- worktree：C:/Users/l0x0hhh/.codex/visualizations/2026/10/23/01a168a0-e55f-71d0-9e15-227e66b38be8/frontend-pages。
- 重构 SHA 以最终交付消息和该分支 git log 为准；不要将本笔快照视作字体已人工验收或已上线。

## 重构修改文件

| 文件 | 职责与变动 |
| --- | --- |
| frontend/src/main.js | 仅页面导入、原入口选择、popstate 与根应用装配/挂载 |
| frontend/src/pages/BorrowPage.js | 原借还运行时模板与 setup，保留表单、快照结算、脱敏接口、动画和图片展示 |
| frontend/src/pages/AdminPage.js | 原管理端模板与 setup，包含页面私有工作簿/邮件常量和按需 ExcelJS |
| frontend/src/pages/AnswersPage.js | 原三态模板、抽签/分享、根背景清理及答案字体 mounted 预加载 |
| frontend/src/services/api.js | 原 apiCall 实现，URL、JSON/FormData、会话头、res.json 与异常传播不变 |
| frontend/src/services/borrow-fireworks.js | 原脚本加载器，顺序、降级及销毁返回值不变 |
| frontend/src/composables/use-site-footer.js | 每次 setup 创建原页脚运行时长、一言和打字机状态，保留卸载清理/减少动态效果 |
| frontend/src/utils/date.js | 两页重复的本地日期格式化合并，缺失值回退不变 |
| test/frontend-source.test.js | 页面与工具直接读取，保留原行为要求和跨页数量约束；补字体/共享接线边界 |
| test/build-config.test.js | 补三个页面导入、运行时模板及原路由装配契约 |
| test/frontend-api.test.js | 模拟请求覆盖会话刷新、JSON、FormData、部分成功原样返回与异常传播 |
| docs/CURRENT_STATUS.md、PROJECT_GUIDE.md、CODE_STRUCTURE.md、REFACTOR_TASKS.md、CHANGELOG.md | 当前交付状态、文件地图、基线与整合说明 |
| docs/tasks/frontend-pages.md | 本任务交付与待验收项 |

所有新增/修改代码首部有简短职责注释。字体快照自身的文件清单可用 git show --stat b159cf9 查看；重构增量以 git diff b159cf9..codex/frontend-pages 为准。

## 兼容边界

- 继续 Vue 运行时字符串模板，未引入 Router、新框架、SFC 或依赖版本变更；CSS 与模板结构保留。
- 原 /borrow、/admin、/answers、尾斜杠、入口占位与 popstate 行为不变；借还页自行处理 ?id= 历史深链接。
- 业务请求调用点随所属页面原样迁移；不改变 URL、方法、body、成功/失败响应或认证头。业务/权限判断仍在原页面和后端。
- 借用清单、个人表单及提交状态仍由页面实例拥有；共享页脚组合函数不保存业务数据。批量冲突、部分成功与提交期间选择/表单保留条件不变。
- 卡片 TSX/展示组合函数、动画参数、裁剪、删除确认、权限展示和减少动态效果保留。
- 答案文案 JSON、字体元数据及预加载模块未移动；生成脚本、HTML 字体 URL、字体资源和字体专项检查不用改路径。只调整 AnswersPage 的相对 import。
- 不改 server.js、db/、deploy/、依赖、运行时数据及生产环境。
- 本轮只划出页面/API/公共工具边界，AdminPage 内部业务仍较大，未进一步拆成领域组件。

## 验证与人工验收

按用户约束，未运行语法/类型检查、测试、构建、应用服务或浏览器自动化，未安装依赖。只做源码阅读、Git 差异和静态文本对照；不能据此宣称可运行或页面已通过验收。

静态对照结果：AnswersPage 主体和 API/粒子加载/页脚原函数文本一致；BorrowPage 与 AdminPage 主体仅替换共享页脚调用、移除重复日期函数，日期格式与原借还页实现一致。原窗口 14 个起始快照文件中，12 个（含全部代码/字体文件和 AGENTS.md）哈希未变；CURRENT_STATUS.md、CHANGELOG.md 期间被其他窗口更新，本任务未写入这些原窗口文件。

专项检查已编写或调整，后续 CI/获准环境应覆盖 frontend-source、build-config、frontend-api、answer-font，以及已有清单、图片和 Motion 检查；本地均未执行。

用户手动验收清单：

1. 桌面/手机分别进入三个页面、尾斜杠和旧设备二维码，检查前进/后退及原页面效果。
2. 批量借用部分冲突、提交期间新增设备/改填表单、失败重试；核对成功项移除及失败项/表单保留。
3. 单/批量归还查询凭证、冲突提示、成功后的答案入口；普通用户信息应脱敏。
4. 管理端登录恢复/退出、权限导航、图片上传和裁剪、工作簿导入导出、上下线及删除二次确认。
5. 答案页首次进入请求约 27 KB 指纹 WOFF、长答案换行、分享/复制、字体失败可读回退和返回入口；借还页不预加载答案字体。
6. 页脚运行时长、一言、粒子加载/离开清理，以及系统减少动态效果设置。

## 整合与后续同步方案（本次不执行）

若整合分支尚无字体修复，先核对并纳入 b159cf9 的完整配套基线，再整合重构提交；若字体窗口已另行提交等价修复，静态核对字体文件和接线后，只 cherry-pick b159cf9 之后的重构提交。共享说明书由整合窗口合并，不整目录覆盖，不混入其他任务未提交代码。

依照 skills/sync-device-management/SKILL.md 分类：运行时增量是 main.js 与新 pages/services/composables/utils；若字体尚未上线，还须一起发布匹配的 HTML、文案、元数据、预加载器及 WOFF。依赖未变，手动增量方式需构建，通常无需 npm ci 或 systemd 重启。测试和文档仅为仓库配套；不得上传本地构建产物或持久化目录。

已有 CI/CD 使用独立版本安装锁定依赖、构建和切换/重启，这与手动增量分类不同。本任务不提供立即操作生产的命令。由整合窗口检查合并结果并按用户授权推送 main 后，再检查 CI 类型/测试/构建与部署结果，人工核对 /borrow、/admin、/answers；当前仍未生产验证。
