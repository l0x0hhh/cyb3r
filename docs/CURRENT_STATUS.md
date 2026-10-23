# 设备管理项目交接卡

> 最后更新：2026-10-23
> 当前事实以本卡为准；稳定规则见 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)，历史记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 当前目标

用户要求把后续重构拆成多窗口任务，并反馈答案之书字体加载慢、先显示默认字体。当前本地已完成字体子集、答案页预加载和可复制的多窗口任务说明；没有创建新窗口、工作树或执行其他重构任务。

字体由现有 4,586,608 字节 TTF 按全部 16 条答案、引号和空格生成 27,236 字节 WOFF（84 个字符，减少 99.41%）。保留原字形；原 TTF 留作离线生成源，页面改用带指纹的小字体。进入 /answers 即预加载，不等结果文字出现才请求，仍保留 swap 可读兜底，不等待字体才出答案。

用户已确认本地字体正常，并授权提交推送。正在通过既有 CI/CD 发布；本次结果尚待确认。上一已确认的生产版本为 99d65b1012020eae98613652d72e10e871c27a81，其历史 CI/CD 成功不覆盖当前字体改动。

## 第一待办

推送本批并核对 GitHub Actions 的 verify、deploy 及目标 SHA，完成后由用户刷新生产 /answers 检查字体。用户已反馈本地字体正常；真实慢网耗时未实测。

多窗口分工见 docs/REFACTOR_TASKS.md：B 后端分层、C 仓储内部优化可从已提交 99d65b1 在独立工作树并行；A 前端页面/API 拆分等字体修复提交成为共同基线后开始。各窗口不自行推送 main 或部署，由当前窗口整合。

## 状态快照

| 状态面 | 当前结论 | 证据与范围 |
| --- | --- | --- |
| 本地完成 | 固定答案迁至 content/answer-book-responses.json，页面和字体生成脚本共用文案 | 16 条文字与 HEAD 静态比较一致，抽签和分享行为未改 |
| 本地完成 | 新字体压缩子集、指纹元数据及答案页专用预加载 | 4,586,608 -> 27,236 字节；原字体家族名称保留；普通借还页不主动预加载答案字体 |
| 本地完成 | 新字体资源检查，核对文件格式/指纹/体积及答案字符覆盖，防止改文案后遗漏重新生成 | 检查代码已添加，尚未在本地或 CI 运行；生成资产随源码提交，生产不需要 Python |
| 本地完成 | 三份可直接复制的窗口任务，定义文件归属、固定仓储 API 和整合顺序 | docs/REFACTOR_TASKS.md；仅完成任务划分，不代表其他窗口已开始或完成重构 |
| 本地验证 | 字体生成后重新读取 WOFF：84 字符无缺失，SHA-256 与元数据相符；固定答案与原列表一致；静态差异检查 | 未运行项目类型检查、测试、构建或自动浏览器；文件体积不是网络耗时测量 |
| 服务器同步 | 本批未提交、推送或部署；最近确认上线 99d65b1 | Actions run 39919338399，历史 verify/deploy success，发布日志为 2026-10-23 15:41:16 |
| 生产验证 | 当前字体优化尚未生产验证 | 旧版清单/提示用户确认本地正常且发布健康检查成功；字体需新一轮人工反馈 |

## 多窗口边界

- 每个窗口独立 worktree/分支，避免共享目录内同时修改；A 统一负责 main.js、前端页面与 API 拆分。
- B 仅改 server.js、backend/ 与对应后端检查，C 仅改 db/ 内部实现及仓储检查；均不改 schema、迁移、依赖版本或生产数据。
- 固定 createSqliteStore 的 databasePath/readCollection/writeCollection/transaction/close，同步调用与完整快照写入语义不变。
- 各任务正常维护文档与独立交付说明；共享文档由整合窗口统一更新。先 C、后 B，再合 A，检查兼容后统一 CI/CD。

## 字体维护

- 文案源：frontend/src/content/answer-book-responses.json；生成信息：同目录 answer-book-font.js。
- 本地工具 Python + FontTools（本次 4.46.0），命令 python scripts/subset-answer-font.py。生成脚本同步写 WOFF、元数据和 HTML URL，保留名称/版权信息及原 TTF。
- 修改答案或原字体后重新生成并提交配套资源；64 KiB 字体体积预算和字符覆盖由新检查约束。不要只提交 HTML 而漏字体、文案或预加载模块。
- 脚本保留旧指纹资产以免删掉其他分支使用的字体；原 TTF 仍为生成源，不是运行时回退资源。

## 生产环境与发布边界

- 腾讯云 43.138.146.44；入口 https://cyb3r.art/borrow、/admin 和 /answers；Node.js 22、Ubuntu 26.04、2 核/2GB。
- 应用 /opt/device-management；服务 device-management；用户 deviceapp；环境配置 /etc/device-management.env。
- 持久化 /var/lib/device-management/data、uploads、qrcodes；发布和代码回退不得覆盖业务数据。
- main 检查成功后按 SHA 发布；统一以 deviceapp 安装锁定依赖、构建独立版本、切换/重启/检查。普通字体更新不重装发布入口，不新增运行依赖，不变更系统配置。
- 用户已完成本地字体验收并授权推送；本批 CI/CD 结果需单独核实，不能沿用原有 CI 成功。

## 已知边界

- Agent 不运行本地类型检查、测试、构建或浏览器自动化；页面由用户手动检查。生成/读取字体资产属于本次资源制作和静态核对。
- 本地 PowerShell Restricted 时用 npm.cmd；前端打开 Vite 的 Local 地址加 /borrow 或 /answers，根地址仅显示占位页。
- 普通用户脱敏、借出设备不能下线、删除设备二次确认等业务规则不变；不上传生产数据、密钥、构建产物或 node_modules。

## 本批涉及文件

- 修改：frontend/index.html、frontend/src/main.js。
- 新增：frontend/src/composables/use-answer-font.js、frontend/src/content/answer-book-responses.json、frontend/src/content/answer-book-font.js、public/fonts/answer-book-results-1b8511e63397.woff、scripts/subset-answer-font.py、test/answer-font.test.js。
- 文档：docs/REFACTOR_TASKS.md、docs/CURRENT_STATUS.md、docs/PROJECT_GUIDE.md、docs/CODE_STRUCTURE.md、docs/CHANGELOG.md。
- AGENTS.md 为用户既有改动，本轮未编辑。原 TTF、其他字体、后端、数据库、依赖版本与生产文件未改。

## 新会话接续

先读本卡，再读 PROJECT_GUIDE.md，按第一待办继续；并行任务先看 REFACTOR_TASKS.md。部署前完整阅读 skills/sync-device-management/SKILL.md 与 docs/CI_CD.md；更新本卡、导航和短历史，区分本地资产核对、项目检查、部署与人工效果验证。
