# 设备管理项目交接卡

> 最后更新：2026-10-21
> 当前事实以本卡为准；稳定规则见 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)，历史记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 当前目标

用户授权推送首批前端修复并继续整理。首批提交 dc5164d 已推送 main，GitHub Actions 类型检查、测试、构建和部署全部成功；发布日志确认运行版本 dc5164d69ca0cfc4b63a3cd89a044e6f8185e9b9，完成时间 2026-10-21 00:04:57（北京时间）。

第二批在本地完成：从 main.js 抽出独立的 useDevicePresentation 组合函数，统一分类图标、图片加载和裁剪状态；修复分类 ID 查不到图标、空垂直位置误当 0%、缺少变体时无效 srcset，以及同一图片后续成功加载后未清除失败状态。用户随后确认第二批无问题并要求继续，现按既有发布流程提交推送；CI/CD 结果待确认。

## 第一待办

由用户手动检查第一批线上及第二批本地效果：分类图标、卡片与详情裁剪、图片加载/失败、切换分类与加入借用清单、桌面和手机交互。第二批代码与配套检查、类型配置、文档须作为整体提交；推送 main 后继续观察 typecheck/test/build/deploy。用户已确认第二批无问题，继续提交发布并整理借用清单状态；新的清单改动另行保留供用户检查。

Agent 按用户要求未运行本地类型检查、测试、构建或浏览器验证。用户仅确认此前第一批本地运行体验正常，未提供具体测试命令及完整结果；随后也确认第二批无问题，但未提供类型检查、测试或构建的详细输出。

## 状态快照

| 状态面 | 当前结论 | 证据与范围 |
| --- | --- | --- |
| 本地完成 | 首批已提交发布：显式注册 Motion 组件、修正卡片入场策略、明确设备/事件类型、CI 类型门禁及 Node SSR 回归 | dc5164d，配套 HTML/Vite/package/锁文件均已一起提交；未包含用户的 AGENTS.md 改动 |
| 本地完成 | 第二批将分类与图片展示从 main.js 拆至 frontend/src/composables/use-device-presentation.js，页面仅创建并暴露组合函数；main.js 减少 122 行 | 不调用业务 API，各实例图片缓存隔离，卡片仍按设备缓存 computed 展示对象 |
| 本地完成 | 分类按接口配置的图标名称或内置 ID 映射查找，仅输出白名单 SVG；空位置默认 50%，保留显式 0%；缺少变体不拼接空 srcset，成功加载可清除旧失败状态 | 共享图片/分类类型，tsconfig 纳入组合函数；新增六项行为回归，尚未执行 |
| 本地验证 | 第二批仅做静态差异与同步分类检查 | 未运行本地 typecheck、测试、构建或浏览器检查；不沿用第一批 CI 成功作为本批验证 |
| 服务器同步 | 第一批已发布到新腾讯云；第二批未提交、推送或部署 | GitHub Actions run 39454107717，verify / deploy 均 success；服务器日志明确 Deployment completed at dc5164d69ca0cfc4b63a3cd89a044e6f8185e9b9 |
| 生产验证 | 第一批自动发布健康检查通过；此前用户回传域名 HTTPS、Certbot 模拟续期、三个服务 enabled / active | 实际登录、借还、图片二维码、真实邮件及本批页面人工验收仍待用户反馈 |

Actions：https://github.com/l0x0hhh/cyb3r/actions/runs/39454107717 。发布启动时 curl 首次连接拒绝后重试成功，不是最终失败；构建保留既有 ExcelJS 大 chunk 提示。

## 活跃事项

1. 完成第二批人工验收和后续 CI；类型检查仍是局部覆盖，不代表前端或后端已经全面 TypeScript 化。
2. 后续按页面边界拆分 frontend/src/main.js，逐步分离 API、状态与展示组件；避免同时改变借还规则和页面结构。
3. 后端接口、业务服务、数据访问仍待分层；SQLite 全量集合读取/回写问题留专项处理。本批没有修改 server.js、数据库或业务 API。

## 生产环境与发布边界

- 当前生产：腾讯云轻量服务器 43.138.146.44，广州四区，2 核 / 2GB、40GB SSD、3Mbps、200GB/月；Ubuntu 26.04 x86_64，ubuntu 具备免密 sudo，2GiB Swap。
- 公网入口：https://cyb3r.art/borrow 和 https://cyb3r.art/admin；域名 A 已指向新机。
- 应用：/opt/device-management；服务 device-management；用户 deviceapp；环境配置 /etc/device-management.env；Node.js 22，精确版本以服务器输出为准。
- 持久化目录：/var/lib/device-management/data、uploads、qrcodes；SQLite 为 data/device-management.sqlite。发布和代码回退不得覆盖业务数据。
- 仓库 l0x0hhh/cyb3r；main 检查成功后按 SHA 自动发布。受限 SSH、Secrets 和开关已配置，第一批本次发布已从 Actions 日志核实。
- 发布入口 /usr/local/sbin/device-management-deploy 由 setup-cd.sh 安装，普通前端改动无需重装。每次自动发布仍会以 deviceapp 执行 npm ci 和构建独立版本，再切换、重启与检查；失败尝试恢复上一版代码/依赖，不回退业务数据。
- 旧腾讯云 106.55.186.151 按迁移流程保持停止；京东云 111.228.27.48 和阿里云 47.119.149.116 为历史中间副本，不能直接切回旧数据库。

## 已知边界

- 第二批仅改前端源码、类型配置、检查和文档，没有新增依赖。手动增量同步需要构建；现有自动发布仍统一执行 npm ci/build/restart。生产数据和系统配置不变。
- 本次 Git SSH 连接未通过主机指纹校验，保留校验并用 HTTPS 成功推送；未修改 origin、SSH known_hosts 或全局 Git 配置。
- 浏览器桌面和手机检查由用户手动完成；Agent 不启动 Playwright 或安装浏览器依赖。
- 普通用户只看到脱敏信息；借出设备不能下线；删除设备必须二次确认，本批不变。
- 不上传 data/、uploads/、public/qrcodes/、frontend/dist/、node_modules/ 或密钥，不在运行中的生产实例执行占用 3000 端口的集成测试。

## 第二批涉及文件

- 修改：frontend/src/main.js、frontend/src/types/device.ts、tsconfig.json、test/frontend-source.test.js。
- 新增：frontend/src/composables/use-device-presentation.js、test/device-presentation.test.js。
- 文档：docs/CURRENT_STATUS.md、docs/PROJECT_GUIDE.md、docs/CODE_STRUCTURE.md、docs/CHANGELOG.md。
- AGENTS.md 为用户既有改动，本轮未编辑或提交；未改后端、依赖锁文件、生产数据、发布脚本或构建产物。

## 新会话接续

先读本卡，再读 PROJECT_GUIDE.md，按第一待办继续；部署时完整阅读 skills/sync-device-management/SKILL.md 与 docs/CI_CD.md。每轮更新本卡及相关导航，并向 CHANGELOG.md 追加短记录；不把本地完成推断为已上线。
