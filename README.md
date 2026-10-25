# 校园设备与物资管理系统

面向网络空间安全学院团委的设备借还与物资管理平台。设备、物资各自管理库存与记录，共用管理员账户和后台入口。

## 关联项目

| 项目 | 关系 |
| --- | --- |
| [l0x0hhh/cyb3r](https://github.com/l0x0hhh/cyb3r) | 本项目设备管理部分的源码基础，保留原有设备借还功能并扩展物资业务。 |
| [Connie622/material-management](https://github.com/Connie622/material-management) | 物资后端由 Connie622 与 ltyyyyy1017 共同实现；关联项目保留原链接和来源说明。 |

本仓库：[Campus-Equipment-and-Supplies-Management-System](https://github.com/ltyyyyy1017/Campus-Equipment-and-Supplies-Management-System)。本次上传分别记录前端与后端提交，设备和物资业务继续使用独立的数据与权限模块。

## 已实现功能

- 用户无需注册或登录，直接借用，无需借用审批；按姓名与完整手机号查询本人记录，公开展示脱敏信息。
- 设备支持独立建档、二维码、批量借还与状态管理。
- 物资支持图片、拍照上传、存放地点、数量、指定数量借出、分次归还与消耗申报。
- 正常归还自动完成；每次申报消耗超过原借出数量的 30% 时提交管理员确认（物资可单独设置阈值），损坏与丢失也需处理。
- 手机号作为借用人查询索引，每笔借用使用独立 ID；手机号不是数据库主键。
- 统一后台分为设备、物资和账户管理区域；设备与物资权限独立。
- Cookie 保持管理员登录、记录访客借用关联、保存允许的页面偏好。
- 管理员密码使用加盐 scrypt 哈希；登录失败限制和锁定状态持久化；支持 SMTP 配置加密。
- 提供仅允许中国大陆 IP 的 Nginx 配置模板和离线 IP 段生成脚本，需在自己的服务器上安装启用。

## 架构

Vue 3 / Vite 前端 → Express API → SQLite。设备数据、物资数据、会话与登录限制分别持久化；图片由 Sharp 处理后存储在上传目录。生产环境由 Nginx 提供 HTTPS 和访问地域控制，Node 服务仅监听本机。

| 路径 | 职责 |
| --- | --- |
| `frontend/src/pages/` | 设备门户、物资门户、统一后台 |
| `server.js`、`backend/records/`、`db/` | 服务装配、设备借还与仓储 |
| `backend/materials/` | 物资库存、借还、异常归还审核 |
| `backend/passwords.js`、`backend/site-state.js` | 密码、会话、访客与登录失败限制 |
| `deploy/`、`scripts/` | 通用部署模板、迁移及校验工具 |
| `test/` | 单元、接口和源码契约测试 |
| `miniprogram/` | 可选的设备借还微信小程序，需配置自己的 AppID 和域名 |

## 本地运行

建议使用 Node.js 22.23 或更新的受支持版本，配合 npm。

```bash
npm ci
node scripts/create-admin-hash.cjs
```

复制 `.env.example` 为 `.env`，把上一步生成的值填写到 `ADMIN_PASSWORD_HASH`。密码不要放入命令参数，也不要提交 `.env`。默认管理员用户名为 `admin`。未配置凭证时，非生产环境仍兼容原项目的开发默认密码；建议始终设置自己的密码哈希。

```bash
npm run build
node --env-file=.env server.js
```

- 设备用户端：<http://127.0.0.1:3000/borrow>
- 物资用户端：<http://127.0.0.1:3000/materials>
- 统一管理后台：<http://127.0.0.1:3000/admin>

首次启动创建空数据库。仅在本地需要示例物资时设置 `MATERIALS_DEMO=true`；生产环境保持关闭。

可选备案号使用构建变量 `VITE_ICP_NUMBER`。在构建进程环境中设置，或写入 `frontend/.env.local` 后构建；未设置则隐藏。不要复用其他站点的备案信息。

## 验证

```bash
npm run typecheck
npm run build
node --test --test-concurrency=1
node scripts/check-materials-template.mjs
node scripts/check-unified-admin.mjs
```

测试使用临时数据；设备接口测试默认占用端口 3000，运行前请停止本地同端口服务，或通过 `TEST_PORT` 指定空闲端口。页面桌面端与手机端操作由维护者手动验收。

## 部署与数据边界

参考 [部署说明](DEPLOY.md)、[项目规则](docs/PROJECT_GUIDE.md) 和 [安全及发布说明](docs/SECURITY.md)。本仓库的 CI 只执行检查，不连接或部署任何现有服务器。

公开版本不包含数据库、真实借用记录、用户上传图片、二维码、环境密钥、服务器备份、本机日志或旧 Git 历史。测试中的姓名、手机号和密码均为合成测试夹具；代码中的开发默认值不代表任何线上凭证。

源码来源与第三方资源见 [NOTICE.md](NOTICE.md)。
