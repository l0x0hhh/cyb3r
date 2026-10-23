# 设备管理项目交接卡

> 最后更新：2026-10-23
> 当前事实以本卡为准；稳定规则见 [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md)，历史记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 当前目标

用户确认第二批无问题并要求继续。第二批提交 7431ed6 已推送 main，GitHub Actions 的类型检查、测试、构建、部署全部成功；服务器日志确认 2026-10-21 00:29:03（北京时间）完成发布，当前生产 SHA 为 7431ed609933fc9f561ca1c86af6f76c0891a2cf。

第三批本地完成：把借用清单增删、10 台上限、面板/弹窗和提交快照抽至 useBorrowCart；失败保留清单和表单，部分成功只移除本次请求确认借出的设备，保留期间新增选择及改填表单；单台借用成功同步移除对应清单项。用户于 10 月 23 日确认本地测试均无问题并明确要求推送，本轮提交发布第三批和提示居中修复，CI/CD 结果待确认。

10 月 23 日用户回传借用、归还成功提示偏右。已在本地将提示外层改为固定全宽 flex 水平居中，Motion 内层只负责透明度和纵向位移；手机顶部间距沿用原值，背景区域不拦截点击，提示操作保持可点击。用户已确认本地测试无问题，本轮与第三批整体提交推送，自动化检查与发布结果待确认。

## 第一待办

用户已确认第三批及提示居中修复本地测试无问题，并授权推送。整体提交源码、类型、检查和文档，推送 main 后确认本提交的 CI 类型检查、测试、构建及部署结果；发布后由用户人工确认线上借用清单与提示居中。

Agent 按要求不运行本地类型检查、测试、构建或浏览器验证。用户未提供具体测试命令与完整输出，不据此宣称已通过全量自动检查。本轮仅提交发布和更新状态，不新增功能。

## 状态快照

| 状态面 | 当前结论 | 证据与范围 |
| --- | --- | --- |
| 本地完成 | 前两批已提交发布：Motion 组件注册/入场、类型门禁、独立图片与分类展示逻辑及兜底 | 当前生产 7431ed6；前一批 dc5164d 保留为上一发布版本 |
| 本地完成 | 第三批新增 useBorrowCart，清单只保存设备 id/name/model，对页面暴露只读摘要列表，修改集中在方法内 | 无 API、个人表单或持久化存储依赖；清单与弹窗按页面实例隔离 |
| 本地完成 | 批量按设备和表单快照提交，成功只移除本次确认借出的 ID；失败与期间新增选择保留，表单未改填且清单为空才重置 | 单台成功同步移除对应项；单台/批量借用入口均增加 submitting 拦截；移除最后一项收起清单和批量弹窗 |
| 本地完成 | 借用与归还共用反馈提示拆为固定居中的外层和 Motion 动画内层，避免内联 transform 覆盖原 translateX(-50%) 定位 | 仅改提示定位及模板包装，消息内容、自动消失时长、关闭和答案链接不变；待用户人工确认 |
| 本地验证 | 第三批及提示定位修复仅做静态差异和同步分类检查；第三批另有七项清单行为回归及页面接线契约 | 用户确认本地测试均无问题，具体命令与完整结果未提供；Agent 未运行本地 typecheck、测试、构建或浏览器检查，本提交待 CI 验证 |
| 服务器同步 | 第二批已部署新腾讯云，第三批及提示定位修复未提交、推送或部署 | Actions run 39457708892，verify / deploy 均 success；日志 Deployment completed at 7431ed609933fc9f561ca1c86af6f76c0891a2cf |
| 生产验证 | 第二批自动发布健康检查通过；此前域名 HTTPS、Certbot 续期演练、三个服务 enabled / active 已获用户回传 | 实际生产登录/借还/邮件和第三批交互未由 Agent 操作；用户已确认第二批无问题，具体人工项目未列明 |

Actions：https://github.com/l0x0hhh/cyb3r/actions/runs/39457708892 。第三批不改服务端借用校验、批量上限、接口或邮件规则，只修正前端选择与表单状态处理。

## 活跃事项

1. 用户已确认第三批本地测试无问题，当前优先确认本次推送的 CI/CD 和线上人工验证。类型检查仍是局部覆盖，既有 main.js 与后端未全面 TypeScript 化。
2. 后续按页面边界继续拆 main.js 的业务状态、API 与展示组件，避免一次同时更改页面结构和借还规则。
3. 后端接口、业务服务和数据访问仍待分层；SQLite 全量集合读取/回写问题留专项处理。当前没有修改 server.js、数据库或生产数据。

## 生产环境与发布边界

- 当前生产：腾讯云轻量服务器 43.138.146.44，广州四区，2 核 / 2GB、40GB SSD、3Mbps、200GB/月；Ubuntu 26.04 x86_64，ubuntu 免密 sudo，2GiB Swap。
- 入口：https://cyb3r.art/borrow 和 https://cyb3r.art/admin；域名 A 已指向新机。
- 应用 /opt/device-management；服务 device-management；用户 deviceapp；环境配置 /etc/device-management.env；Node.js 22，精确版本以服务器输出为准。
- 持久化 /var/lib/device-management/data、uploads、qrcodes；SQLite 为 data/device-management.sqlite。代码发布和回退不得覆盖业务数据。
- 仓库 l0x0hhh/cyb3r，main 检查成功后按 SHA 发布；受限 SSH、Secrets、开关均已配置，本次第二批已从 Actions 日志核实。
- /usr/local/sbin/device-management-deploy 由 setup-cd.sh 安装，普通前端改动无需重装；自动发布统一以 deviceapp 安装锁定依赖、构建独立版本，再切换/重启/检查。失败尝试恢复上一版代码与依赖，不回退业务数据。
- 旧腾讯云 106.55.186.151 按迁移流程保持停止；京东云 111.228.27.48 与阿里云 47.119.149.116 为历史中间副本，不能直接切回旧数据库。

## 已知边界

- 第三批没有新增依赖或改系统配置；手动增量需构建，现有 CI/CD 仍统一 npm ci/build/restart。生产数据、证书和环境配置不变。
- Git SSH 曾未通过主机校验，本次继续使用保留 TLS 校验的 HTTPS 推送，未修改 origin、known_hosts 或全局配置。
- 普通用户只看到脱敏信息；借出设备不能下线；删除设备必须二次确认，本批不变。
- 不上传 data/、uploads/、public/qrcodes/、frontend/dist/、node_modules/ 或密钥，不在运行中的生产实例执行占用 3000 端口的集成测试。

## 待发布涉及文件（第三批与提示定位修复）

- 修改：frontend/index.html、frontend/src/main.js、frontend/src/types/device.ts、test/frontend-source.test.js。
- 新增：frontend/src/composables/use-borrow-cart.js、test/borrow-cart.test.js。
- 文档：docs/CURRENT_STATUS.md、docs/PROJECT_GUIDE.md、docs/CODE_STRUCTURE.md、docs/CHANGELOG.md。
- AGENTS.md 为用户既有改动，本轮未编辑或提交；未改后端、依赖锁文件、生产数据、发布脚本或构建产物。

## 新会话接续

先读本卡，再读 PROJECT_GUIDE.md，按第一待办继续；部署时完整阅读 skills/sync-device-management/SKILL.md 与 docs/CI_CD.md。每轮更新本卡及导航，并向 CHANGELOG.md 追加短记录，不把本地完成推断为上线。
