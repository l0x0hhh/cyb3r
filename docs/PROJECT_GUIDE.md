# 学院设备管理系统项目导航

> 最后更新：2026-09-12
> 本文是稳定规则和定位入口；当前任务与验证状态只看 [`CURRENT_STATUS.md`](CURRENT_STATUS.md)，历史记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 1. 项目概览

学院内部设备借还系统，提供普通用户借还门户和管理员后台。生产入口为 `https://cyb3r.art/borrow` 与 `https://cyb3r.art/admin`，根路径重定向到 `/borrow`。系统使用 Node.js/Express、Vue 3/Vite，业务数据已由 SQLite 持久化，旧 JSON 文件仅用于首次启动迁移和人工回滚备份；前置 Nginx，适合当前小规模内部使用。

## 2. 产品红线

### 入口与二维码

- 普通用户使用 `/borrow`；归还成功通知可进入普通用户答案彩蛋页 `/answers`；管理员使用 `/admin`；微信小程序目录 `miniprogram/` 暂缓，不纳入网页端迭代。
- 统一二维码指向 `/borrow`；设备二维码使用 `/borrow?id=<deviceId>`；两套二维码长期并存。公开设备列表使用响应式独立列式瀑布流，手机 2 列、平板 3 列、桌面 4 列，设备按顺序分列。
- 用户端、管理端和页脚使用暨南大学网络空间安全学院品牌；用户端顶部品牌栏和“借设备 / 还设备”分段控件使用宽版容器，两个选项自动均分；归还查询内容保持可读限宽。用户端和管理端底栏显示运行时长、一次性诗词/哲学一言及服务备案号，备案号链接至工信部备案官网。
- 用户端 `/borrow` 支持鼠标和触摸点击粒子特效；特效 Canvas 不拦截页面操作，按钮、表单控件、链接和弹窗点击不触发；管理端 `/admin` 不创建 Canvas、不加载特效脚本。

### 借用与归还

- 公共列表只展示 `online + available` 设备；借用时必填姓名、11 位手机号、专业和用途，学号/工号可选。
- 支持批量借用：用户可将多台设备加入借用清单（最多 10 台），共用一份借用信息一次提交；后端 `POST /api/records/borrow-batch` 逐个校验设备存在、在线且未借出，单台冲突不影响其他设备借出，部分成功返回成功与冲突列表，每台成功记录独立写入，批量只发一封汇总邮件。
- 支持借用未录入库存的设备：用户填写设备名称后调用 `POST /api/records/borrow-other`，仍写入普通借用记录并进入管理员当前借出列表，不创建或修改库存设备；记录标记 `isOtherDevice`，后续可正常用户归还或管理员强制归还。
- 支持批量归还：用户查询待归还设备后可勾选多台，统一备注一次归还（备注不同请各自单独归还），凭证覆盖所选记录；管理员可在当前借出列表勾选多台批量强制归还（`POST /api/records/return-batch` / `force-return-batch`），只写一条汇总操作日志。
- 后端必须再次校验设备存在、在线且未借出，不能只依赖前端状态。
- 用户凭姓名和完整手机号查询本人未归还记录；查询成功签发 10 分钟归还凭证；普通用户不应看到他人的完整信息。
- 普通用户只看到脱敏姓名和手机号；管理员才可查看完整借用信息、强制归还、归档、恢复和永久删除已归还记录。
- 单台归还或全部成功的批量归还完成后，用户端非阻塞通知栏显示“打开答案之书”；存在批量冲突时只显示归还结果，不展示彩蛋入口。

### 答案之书彩蛋

- `/answers` 是复用前端入口的普通用户页面，不需要登录，不新增 API，也不记录用户问题或答案；页面采用参考站点的白底居中三态布局和核心文案。
- 初始态展示本地托管的 `answer-book.png` 与“在心中思考一个问题，点击答案之书探索可能的答案”，翻书态展示本地 loading 动画与“正在翻书...”，结果态展示随机答案、“发给朋友”和返回 `/answers` 首页的“再抽一次”；结果文字需在桌面端和移动端容器内自适应换行。
- “发给朋友”在支持系统分享的移动端调用系统分享，否则复制分享文案并显示“文案已复制，快发给朋友咯”；点击站点标题返回 `/borrow`；页面适配桌面端和 390px 移动端，并遵守 `prefers-reduced-motion`。
- 文案仅为娱乐性彩蛋，不应被解释为设备管理、健康或其他现实决策建议。

### 设备状态与分类

- `status` 表示借用状态：`available` / `borrowed`；`operationalStatus` 表示运营状态：`online` / `offline`。
- 借出中的设备不能下线、不能删除，必须归还后才能下线或删除；下线前二次确认，再填写原因；离线设备不能借用。
- 新建和编辑设备必须使用有效分类；`cat-other` 不可删除但可排序；删除普通分类时设备迁移到 `cat-other`。
- 删除设备必须二次确认，并可能级联删除借用记录。
- 管理端支持卡片/列表视图、批量分类、批量上线、批量下线和 XLSX 导入导出；批量操作先完整校验，失败时零写入并只为成功批次写一条汇总日志。

### 图片与隐私

- 上传仅允许 JPEG、PNG、WebP，服务端检查文件签名，单文件不超过 20 MB；Sharp 生成详情和缩略 WebP，原图迁移命令可重复执行且不删除原图。
- 设备图片保存宽高、展示高度和垂直位置；旧数据缺失字段时必须兼容回退。
- 操作日志不得写入借用人姓名、手机号等隐私；示例、文档和测试不得提交真实密码、完整手机号或真实借用人信息。

### 邮件通知

- 管理员可配置 SMTP、收件人、借出/用户归还/管理员归还开关和模板；凭据使用 `EMAIL_CONFIG_KEY` 加密写入 `DATA_DIR/email-settings.json`，接口不回传原文。
- 记录成功写入后异步发送；发送失败不回滚业务结果，当前没有持久化重试队列。
- 三类事件（借出、用户归还、管理员归还）使用各自独立的主题和正文模板（`templates.{borrow|return|adminReturn}`）；默认模板事件名写死、其余字段使用变量，管理端开箱即用显示完整的事件、明细、时间和备注结构。旧部署仅含 `subjectTemplate`/`bodyTemplate` 时三类事件整组回退到旧模板；识别到系统历史“标题 + `{{recordList}}`”简略正文时自动升级为完整模板；保存后旧字段始终同步为借出模板，旧前端读取不受影响。
- 批量事件（批量借出/批量归还/批量强制归还）只发一封汇总邮件，并按借用人分组展示姓名、电话、专业/部门、用途和逐条设备明细；`{{deviceName}}`/`{{deviceModel}}`/`{{deviceId}}` 仍自动渲染为顿号分隔的完整清单，重复名称或型号不丢失，单台事件保持逐台单邮件。
- 模板支持事件、设备、借用人、时间和归还备注变量，以及 `{{deviceNotice}}`（待上线提醒）和 `{{recordList}}`（按借用人分组的明细）。其他设备的名称保持干净，型号为空显示“暂未录入（待管理员上线后补充）”，编号缺失显示“待管理员上线后生成”；旧模板未使用新变量时，系统自动补充提醒/批量明细，多借用人不会再把第一人显示成整批唯一借用人。
- 显式 `*Masked` 变量始终脱敏。测试邮件使用模拟数据和当前草稿，不读取真实记录、不保存草稿；测试发送按所选事件使用对应模板，并与正式单台通知共用明细格式。

## 3. 技术全景

```text
浏览器 /borrow 或 /admin
        -> Nginx :80/:443 (HTTPS, HTTP/2, gzip, 静态缓存)
        -> Express / Node.js :3000
           -> REST API
           -> Vue/Vite 静态资源
           -> SQLite 数据库、上传图片、二维码
```

主要依赖：Node.js 22.5+、Express 4、Vue 3、Vite 8、Helmet、express-rate-limit、Multer、Sharp、qrcode、ExcelJS（仅工作簿功能按需加载）；运行时和迁移脚本均使用 Node 内置 `node:sqlite`，不额外引入原生编译依赖。当前 Vue 使用运行时模板，CSP 仍需 `unsafe-eval`。

## 4. 代码地图

| 路径 | 职责 | 何时查看 |
| --- | --- | --- |
| `server.js` | Express API、权限、校验、SQLite 数据读写、上传、二维码和页面入口 | 后端接口、数据、隐私、安全 |
| `db/repository.js` | SQLite 初始化、JSON 首次迁移、对象字段转换和事务封装 | 数据源切换、事务、数据库故障 |
| `email-service.js` | SMTP 连接、认证和纯文本投递 | 邮件协议或投递问题 |
| `frontend/src/main.js` | Vue 用户门户、答案之书彩蛋、管理后台和交互状态 | 页面行为、表单、接口调用 |
| `frontend/index.html` | HTML 入口、用户端/答案之书/管理端全局响应式样式 | 布局、视觉、移动端样式、用户端粒子层样式 |
| `public/js/anime.min.js` | Anime.js 2.2.0 静态动画依赖 | 用户端点击粒子特效按需加载 |
| `public/js/fireworks.js` | 用户端 Canvas 粒子和圆环动画 | `/borrow` 点击特效、交互过滤和卸载清理 |
| `vite.config.js` | Vite 根目录、代理和构建输出 | 构建或开发代理 |
| `.github/workflows/ci.yml` | GitHub Actions CI：在 PR 和 `main` 推送时执行 Node.js 语法检查、测试和前端构建；不负责生产部署 | CI 配置或验证流程 |
| `scripts/migrate-image-variants.js` | 旧图片 WebP 变体迁移 | 迁移或图片兼容 |
| `test/` | 后端、前端、邮件、安全和部署契约测试 | 行为改动后补测试 |
| `miniprogram/` | 暂缓的微信小程序普通用户端 | 仅处理小程序事项时查看 |
| `data/`、`uploads/`、`public/qrcodes/` | 本地开发持久化和资源；`data/device-management.sqlite` 为运行时业务数据库，旧 JSON 仅用于首次迁移或备份 | 不提交真实数据；部署不得覆盖数据库、JSON 备份、上传和二维码 |
| `frontend/dist/` | Vite 生成产物 | 构建生成，不手工编辑 |

详细文件锚点、调用链和数据写入关系见 [`CODE_STRUCTURE.md`](CODE_STRUCTURE.md)。

## 5. 数据与兼容

生产持久化目录由环境变量指定，通常为 `/var/lib/device-management/data`、`/var/lib/device-management/uploads` 和 `/var/lib/device-management/qrcodes`；SQLite 默认保存为 `${DATA_DIR}/device-management.sqlite`，也可通过 `DATABASE_PATH` 指定。当前业务以 SQLite 为唯一数据源，旧 JSON 文件只在数据库不存在时参与首次迁移，不再作为运行时回退源。

首次迁移使用的旧 JSON 文件包括：

- `devices.json`：设备、图片引用、分类、借用状态和运营状态。
- `records.json`：借用人、设备快照、借出/归还时间、归还备注和归档时间。
- `operation-logs.json`：成功管理动作及设备元数据，不含借用人隐私。
- `email-settings.json`：SMTP、通知开关和模板；SMTP 密文不可提交仓库。
- `admin-users.json`：管理员账号、scrypt 密码哈希、角色、权限和时间戳。

SQLite 运行时：`db/schema.sql` 定义目标表结构，`db/repository.js` 在数据库不存在时调用同等迁移逻辑导入旧 JSON；数据库存在后，所有业务读写都经对象适配层进入 SQLite。关键跨表操作使用 `BEGIN IMMEDIATE` 事务，服务退出前关闭数据库句柄，并启用 WAL 和 busy timeout。独立脚本 `npm run migrate:sqlite -- --data-dir <JSON目录> --output <SQLite文件>` 仍可用于生成不覆盖已有文件的离线副本。

兼容规则：旧设备缺少分类按 `cat-other`，缺少运营状态按 `online`，缺少图片变体或展示字段按旧图片/自然比例回退；旧记录 `department`/`notes` 分别兼容读取为 `major`/`purpose`；新写入暂时保留旧字段。详情字段和完整示例见 `CODE_STRUCTURE.md` 及源码测试，不在本入口重复大段 JSON。

## 6. 任务路由

| 任务 | 先读什么 | 主要验证 |
| --- | --- | --- |
| 新功能或修复 | `CURRENT_STATUS.md` -> 本文 -> `server.js` 或 `frontend/src/main.js` | 定向契约测试、语法检查、`npm test` |
| 样式/响应式 | `CURRENT_STATUS.md` -> 本文 -> `frontend/index.html` | 前端契约测试；浏览器由用户手动验收 |
| 邮件通知 | 本文邮件规则 -> `email-service.js`、邮件测试 | 邮件协议/通知测试和真实 SMTP 手动验收 |
| 图片迁移 | 本文图片规则 -> `scripts/migrate-image-variants.js` | 先 `npm run migrate:images -- --dry-run`，再确认正式命令 |
| 部署/同步 | `CURRENT_STATUS.md` -> [`DEPLOY.md`](../DEPLOY.md) -> [`skills/sync-device-management/SKILL.md`](../skills/sync-device-management/SKILL.md) | 分类改动、构建、服务健康检查和生产人工确认 |
| 微信小程序 | 本文入口规则 -> `miniprogram/` | 开发者工具和真机由用户手动验证 |

## 7. 本地验证

### CI 自动验证

- `.github/workflows/ci.yml` 在拉取请求和推送 `main` 时运行，使用 Node.js 22.5.0 执行 `npm ci --no-audit --no-fund`、服务端/数据库/前端语法检查、`npm test` 和 `npm run build`。
- CI 只使用 GitHub Actions 临时运行器中的源码和测试数据，不读取生产持久化目录，不发送邮件，也不执行服务器部署。
- 生产发布仍由管理员在授权服务器终端执行 `sudo bash /opt/device-management/deploy/update-from-git.sh`；是否增加手动点击发布或自动 CD，需另行评估权限、密钥和回滚方案。

```bash
node --check server.js
node --check frontend/src/main.js
npm test
npm run build
```

集成测试若与本机已运行服务冲突，使用独立测试端口；构建若受本机既有 `frontend/dist` 权限影响，使用临时输出目录验证，不覆盖现有产物。涉及页面时，Agent 不启动 Playwright、下载浏览器或安装额外依赖，交付时提供用户手动检查项。

## 8. 生产边界

- 应用目录：`/opt/device-management`；服务：`device-management`；Node 监听 `127.0.0.1:3000`；Nginx 对外提供 `https://cyb3r.art`。
- GitHub 仓库：`git@github.com:l0x0hhh/cyb3r.git`；服务器使用只读 Deploy Key，日常更新执行 `deploy/update-from-git.sh`。
- 脚本会根据实际改动决定依赖安装、前端构建和服务重启，并保护 `/var/lib/device-management`。手动同步必须逐文件安装并使用 `deviceapp` 所有权，不能目录级复制暂存目录元数据。
- Nginx 上传请求体模板为 `22m`，应用层仍严格限制单个图片 20 MB；更新脚本不会自动写入 `/etc` 或 reload Nginx。
- 任何部署都不得上传或覆盖 `data/`、`uploads/`、`public/qrcodes/`、`frontend/dist/`、`node_modules/` 和服务器密钥。

首次部署参考 [`DEPLOY.md`](../DEPLOY.md)；同步任务必须先完整读取项目 Skill。

## 9. 文档维护

- 当前事实只写 `CURRENT_STATUS.md`：目标、第一待办、状态快照、活跃事项和阻塞。
- 稳定产品规则、接口/数据兼容、代码职责或部署边界变化时更新本文或 `CODE_STRUCTURE.md`。
- 每轮完成后在 `CHANGELOG.md` 追加一条短记录；不要把历史过程复制回启动文档。
- 不在任何文档中写入真实密码、完整手机号、真实借用人信息或生产 SMTP 密钥。
