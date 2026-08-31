# 项目协作入口

项目文档采用“交接卡 -> 稳定导航 -> 按需资料”三级结构。开始处理新任务前先读 [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md)，再读 [`docs/PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md)；历史记录在 `docs/CHANGELOG.md`，默认不读。

## 新对话启动规则

1. 先读取 `docs/CURRENT_STATUS.md`，只恢复当前目标、第一待办、状态快照和阻塞。
2. 再阅读 `docs/PROJECT_GUIDE.md`，了解产品红线、代码地图、任务路由和生产边界。
3. 开始实质工作前，先向用户简要汇报已恢复的项目阶段、未完成事项和本次准备处理的内容。
4. 如果用户只说“继续项目”“接着做”或类似表述，默认从 `docs/CURRENT_STATUS.md` 的首个待办开始；不得自行假定本地改动已经部署到服务器。

## 推荐阅读顺序

1. 根据任务类型按需打开 `docs/CODE_STRUCTURE.md`、`DEPLOY.md`、`skills/sync-device-management/SKILL.md` 或源码。
2. 对应源码入口为：
   - 后端接口、权限、数据：`server.js`
   - 用户端和管理端交互：`frontend/src/main.js`
   - 页面样式：`frontend/index.html`
   - 自动化测试：`test/`
   - 服务器部署：`deploy/` 与 `DEPLOY.md`
3. 使用文本搜索定位函数或接口，不要无目的读取大型源码或历史文档。

## 代码同步与部署

用户询问“同步到服务器”“更新线上代码”“部署这次改动”或类似问题时，必须先完整读取 [`skills/sync-device-management/SKILL.md`](skills/sync-device-management/SKILL.md)，并按该 Skill 判断上传文件、`npm ci`、Vite 构建、systemd 重启和持久化目录保护。不要要求用户重复提供已经记录的服务器 IP、目录或服务名。

如果本次任务由你修改了代码，在交付时必须按同一 Skill 主动给出与实际改动匹配的同步方案；不得把 `data/`、`uploads/`、`public/qrcodes/`、`frontend/dist/` 或 `node_modules/` 当作增量源码上传。

## 每次迭代必须更新说明书

- 代码、验证结果、部署状态、阻塞项或下一步变化：更新 `docs/CURRENT_STATUS.md`，分别写清本地完成、本地验证、服务器同步和生产验证。
- 用户可见功能、业务规则、接口、权限、数据字段、文件职责、环境变量、持久化目录或部署步骤变化：同步更新 `docs/PROJECT_GUIDE.md` 或 `docs/CODE_STRUCTURE.md`。
- 每轮完成后在 `docs/CHANGELOG.md` 追加一条短记录；不要把历史过程复制回 `CURRENT_STATUS.md` 或 `PROJECT_GUIDE.md`。
- 只改样式细节或修正文案时，可只更新交接卡并追加简短历史记录。

## 项目约束

- 普通用户只能看到脱敏借用信息，管理员才能查看完整个人信息。
- 借出中的设备不能下线；必须归还后才能下线。
- 删除设备可能级联删除借用记录，必须保留二次确认。
- 生产数据、上传图片和二维码位于服务器持久化目录，更新代码时不得覆盖。
- 不提交密码、完整手机号、真实借用人信息或其他敏感数据到文档和示例。
- 当前目录是可用的 Git 仓库，已存在提交历史；不要假定工作区干净、提交已推送或分支保护已配置。

## 基础验证

```bash
node --check server.js
npm test
npm run build
```

涉及页面交互时，浏览器桌面端和移动端检查由用户手动完成。Agent 不得为此自动启动 Playwright、下载浏览器或安装额外浏览器依赖；交付时只需列出建议检查项并明确等待用户反馈。
