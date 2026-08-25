# 设备借还微信小程序

这是普通用户端微信小程序，独立于现有 `frontend/` 网页端，复用生产 API `https://cyb3r.art`。

## 当前页面

- `pages/borrow/index`：可借设备列表、搜索和分类筛选
- `pages/detail/index`：设备详情和状态
- `pages/borrow-form/index`：借用信息填写
- `pages/return/index`：姓名 + 完整手机号查询和归还

管理员操作仍使用网页端 `/admin`，本阶段不在小程序中重复实现。

## 微信开发者工具

1. 导入本目录 `miniprogram/`。
2. 项目 AppID 已写入 `project.config.json`，仅包含公开 AppID，不包含 AppSecret。
3. 本地开发可以暂时关闭“校验合法域名”；提交前必须配置并启用 `https://cyb3r.art`。
4. 在微信公众平台的“开发管理 → 服务器域名”中同时配置：
   - request 合法域名：`https://cyb3r.art`
   - downloadFile 合法域名：`https://cyb3r.art`（设备图片和院徽通过 `<image>` 加载）
5. 保存域名配置后，在微信开发者工具中重新编译；本地调试也可以暂时开启“不校验合法域名”。
6. 用模拟器和真机分别检查图片加载、借用、归还和空状态。

小程序不会直接读取本地 `data/`、`uploads/`，也不会把 AppSecret 放进前端代码。
