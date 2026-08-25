# 学院设备管理系统

供学院内部使用的轻量设备借还系统。普通用户扫描统一二维码后，可以查看可借设备、填写信息借用，并通过姓名和完整手机号查询本人待归还设备；管理员负责设备、状态和历史记录管理。

## 新任务从这里开始

- 项目结构、业务规则、接口、数据和部署现状：[`docs/PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md)
- 统一借还门户详细设计：[`docs/plans/2026-07-21-unified-device-portal-design.md`](docs/plans/2026-07-21-unified-device-portal-design.md)
- Ubuntu 部署脚本：[`deploy/setup-server.sh`](deploy/setup-server.sh)

## 本地运行

```bash
npm install
npm run build
npm start
```

访问：

- 用户统一借还门户：`http://127.0.0.1:3000/borrow`
- 管理后台：`http://127.0.0.1:3000/admin`
- 旧单设备链接：`http://127.0.0.1:3000/borrow?id=<deviceId>`

开发环境未设置密码时会使用默认开发密码；生产环境必须通过 `ADMIN_PASSWORD` 环境变量设置管理员密码，否则服务会拒绝启动。

## 验证

```bash
node --check server.js
npm test
npm run build
```

生产数据、上传图片和二维码应使用独立持久化目录，更新项目代码时不要覆盖这些目录。具体路径和更新流程见持续说明书。
