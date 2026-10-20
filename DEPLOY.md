# Ubuntu 公网服务器部署指南

以下方案使用 Node.js 22、systemd、Nginx 和 Let's Encrypt HTTPS。当前项目正式域名为 `cyb3r.art`。

现有生产已迁至腾讯云 `43.138.146.44`（Ubuntu 26.04）；后续 CI/CD 一次性接入和日常更新请看 [`docs/CI_CD.md`](docs/CI_CD.md)。不要对已经上线的实例重跑整机初始化或覆盖持久化目录。自动化文件已实现不代表远程配置已经完成。

## 1. 准备域名和服务器

在域名控制台添加 A 记录：

```text
cyb3r.art -> 43.138.146.44
```

服务器建议使用 Ubuntu 22.04 或 24.04，并开放 TCP 端口 `22`、`80`、`443`。不要向公网开放应用端口 `3000`。

安装基础软件和 Node.js 22：

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx curl

curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs

node --version
npm --version
```

## 2. 创建运行用户和持久化目录

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin deviceapp
sudo mkdir -p /opt/device-management
sudo mkdir -p /var/lib/device-management/data
sudo mkdir -p /var/lib/device-management/uploads
sudo mkdir -p /var/lib/device-management/qrcodes
```

首次接入已有 GitHub 仓库时，请按第 8 节“首次接入现有生产源码”的流程备份旧目录后执行 Git 克隆。不要使用 `scp -r .` 上传整个项目：`scp` 不读取 `.gitignore`，可能把本地 `data/`、`uploads/`、`public/qrcodes/`、`frontend/dist/`、`node_modules/` 以及其他敏感文件上传到服务器。无法使用 GitHub 时，也必须在临时目录中按文件白名单逐项上传；增量更新必须按 [`skills/sync-device-management/SKILL.md`](skills/sync-device-management/SKILL.md) 逐文件同步。

上传完成后，在服务器执行：

```bash
sudo chown -R deviceapp:deviceapp /opt/device-management
sudo chown -R deviceapp:deviceapp /var/lib/device-management

cd /opt/device-management
sudo -u deviceapp npm ci
sudo -u deviceapp npm run build
sudo -u deviceapp npm test
```

生产数据、上传图片、二维码和 `data/email-settings.json` 均以服务器持久化目录为准，禁止用本地目录覆盖。若确需迁移数据，必须先单独备份并确认目标文件，再由管理员执行定向迁移。

## 3. 配置生产环境变量

复制示例并编辑：

```bash
sudo cp /opt/device-management/deploy/device-management.env.example /etc/device-management.env
sudo nano /etc/device-management.env
```

至少修改：

```ini
ADMIN_PASSWORD=一个至少16位的随机密码
APP_BASE_URL=https://cyb3r.art
EMAIL_CONFIG_KEY=32字节随机密钥的 hex 表示（64位）
```

生成邮件配置加密密钥：

```bash
openssl rand -hex 32
```

`EMAIL_CONFIG_KEY` 只保存在 `/etc/device-management.env`，不要写入仓库、部署命令或邮件配置页面。该密钥必须长期保持不变；更换后，既有 `email-settings.json` 中的 SMTP 密码/授权码无法解密，需要管理员重新录入。

保护配置文件：

```bash
sudo chown root:deviceapp /etc/device-management.env
sudo chmod 640 /etc/device-management.env
```

`APP_BASE_URL` 非常重要，新生成的设备二维码会使用这个 HTTPS 地址。

### 3.1 配置管理员邮件通知

1. 填写并重启服务，使 `EMAIL_CONFIG_KEY` 生效。
2. 登录 `https://cyb3r.art/admin`，打开“邮件通知”Tab。
3. 录入 SMTP 服务器、端口、加密方式、发件邮箱和邮箱密码/授权码，填写一个或多个接收邮箱，勾选需要通知的借出/归还事件，并保存。
4. 点击“发送测试邮件”确认 SMTP 可用。保存后的密码不会回显，只显示“凭据已保存”。

系统会在借用、用户归还或管理员归还记录成功写入后异步发送邮件；SMTP 失败只写服务端日志，不影响业务结果。当前没有持久化重试队列，生产上应通过测试邮件和日志确认配置有效。

邮件模板支持 `eventLabel`、`deviceName`、`deviceModel`、`deviceId`、`borrowerName`、`borrowerId`、`borrowerPhone`、`borrowerPhoneMasked`、`major`、`purpose`、`borrowedAt`、`eventAt`、`returnNotes`。默认通知使用脱敏手机号 `138****`。

## 4. 注册 systemd 服务

```bash
sudo cp /opt/device-management/deploy/device-management.service /etc/systemd/system/device-management.service
sudo systemctl daemon-reload
sudo systemctl enable --now device-management
sudo systemctl status device-management
```

查看实时日志：

```bash
sudo journalctl -u device-management -f
```

本机检查：

```bash
curl -I http://127.0.0.1:3000/admin
```

## 5. 配置 Nginx

```bash
sudo cp /opt/device-management/deploy/nginx.conf /etc/nginx/sites-available/device-management
sudo nano /etc/nginx/sites-available/device-management
```

项目提供的配置已使用 `cyb3r.art`，确认无误后执行：

```bash
sudo ln -s /etc/nginx/sites-available/device-management /etc/nginx/sites-enabled/device-management
sudo nginx -t
sudo systemctl reload nginx
```

## 6. 开启 HTTPS

确认域名已经解析到服务器后执行：

```bash
sudo certbot --nginx -d cyb3r.art
sudo certbot renew --dry-run
```

浏览器访问：

```text
https://cyb3r.art/borrow
https://cyb3r.art/admin
```

## 7. 防火墙

如果启用了 UFW：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

应用只监听 `3000`，该端口应由 Nginx 在服务器内部访问，不要在云服务器安全组中开放。

## 8. GitHub 私有仓库更新

生产源码通过只读 GitHub Deploy Key 从 `git@github.com:l0x0hhh/cyb3r.git` 拉取。密钥只保存在服务器的 `/var/lib/device-management/.ssh/`，不要提交到仓库，也不要使用个人 GitHub 私钥。

首次接入现有生产源码时，先确认本地代码已经推送到 GitHub，并在服务器备份当前源码目录。生产数据不在应用目录，而是在 `/var/lib/device-management`，不会随源码备份或 Git 更新覆盖：

```bash
STAMP="$(date +%Y%m%d-%H%M%S)"
sudo systemctl stop device-management
sudo mv /opt/device-management "/opt/device-management-before-git-${STAMP}"
sudo install -d -o deviceapp -g deviceapp -m 755 /opt/device-management
sudo -u deviceapp env HOME=/var/lib/device-management \
  GIT_SSH_COMMAND="ssh -i /var/lib/device-management/.ssh/github_deploy -o IdentitiesOnly=yes -o UserKnownHostsFile=/var/lib/device-management/.ssh/known_hosts -o StrictHostKeyChecking=yes" \
  git clone git@github.com:l0x0hhh/cyb3r.git /opt/device-management
sudo -u deviceapp env HOME=/var/lib/device-management npm ci --prefix /opt/device-management
sudo -u deviceapp env HOME=/var/lib/device-management npm run build --prefix /opt/device-management
sudo systemctl start device-management
sudo systemctl status device-management
```

确认首次接入正常后，旧源码备份目录可以保留一段时间，确认无误后再由管理员手动删除。不要删除或移动 `/var/lib/device-management`。

完成 [`docs/CI_CD.md`](docs/CI_CD.md) 一次性配置并启用 `CD_ENABLED=true` 后，日常修改提交并推送 main，CI 成功后自动发布，不再登录服务器拉取代码。每个版本在独立目录安装依赖和构建，切换前保护当前运行版本，失败尝试回退代码与依赖。

管理员手工重试已通过 CI 的提交时执行（将占位符换为完整 SHA）：

```bash
sudo /usr/local/sbin/device-management-deploy <40位已通过CI的提交SHA>
```

脚本验证提交属于 main 历史，拒绝过时提交覆盖新版或分叉历史。每个新版本都执行独立的锁定依赖安装、构建、切换重启与健康检查；发布失败返回非零，即使恢复旧版成功也不会报告发布成功。数据库、图片、二维码及邮件环境密钥不随代码回退。对数据库结构不兼容的变更必须单独设计迁移。

自动化启用后，运行目录是版本符号链接且源码不含 `.git`。查看当前版本、磁盘和服务：

```bash
readlink -f /opt/device-management
sudo du -sh /opt/device-management-releases/*
sudo systemctl status device-management --no-pager
```

生产服务占用 3000 端口时不要在服务器执行 `npm test`；测试应在本地完成。

## 9. 数据备份

当前业务版本以 SQLite 作为唯一运行时数据源，默认数据库为 `/var/lib/device-management/data/device-management.sqlite`；旧 JSON 文件仅用于首次迁移和人工回滚备份。数据库、旧 JSON、上传图片、二维码和环境配置都应纳入备份范围：

```bash
sudo tar -czf /root/device-management-$(date +%F-%H%M).tar.gz /var/lib/device-management
```

首次接入或生产迁移时，必须先在本地生成独立副本并核对数量；运行时初始化仅在数据库不存在时导入旧 JSON，数据库已存在时不会覆盖或回写。禁止直接指定生产数据库路径覆盖已有文件：

```bash
npm run migrate:sqlite -- --data-dir ./data --output ./data/device-management.sqlite
```

迁移脚本和运行时要求 Node.js 22.5+，使用内置 `node:sqlite`。生产迁移前先备份 `/var/lib/device-management`，确认数据库完整性和记录数量，再以服务用户启动新版本；旧 JSON 清理必须另行评审，不随源码更新自动执行。源码同步、构建和重启均不得覆盖 `/var/lib/device-management`。

建议通过 cron 每天备份，并将备份同步到另一台机器或对象存储。更新代码时不要覆盖 `/var/lib/device-management`。

## 10. 常见故障

- 页面能打开但接口报错：检查 `sudo journalctl -u device-management -n 100`。
- Nginx 显示 502：检查应用是否监听 3000，以及 `systemctl status device-management`。
- 二维码还是旧域名：确认 `APP_BASE_URL`，重启服务后在后台重新生成二维码。
- 测试邮件发送失败：确认 `EMAIL_CONFIG_KEY` 未变更、后台 SMTP 主机/端口/加密方式与邮箱服务商要求一致，并查看 `sudo journalctl -u device-management -n 100`；QQ、163 等服务通常要求填写授权码而不是网页登录密码。
- 图片上传失败：仅允许 JPEG、PNG、WebP，单文件最大 20 MB；服务会通过 Sharp 生成 WebP 详情图和缩略图，先确认已按生产流程执行 `npm ci` 并完整安装依赖。
- 旧设备图片加载仍慢：历史图片不会自动转换，可在管理后台重新上传该设备图片以生成优化后的缩略图和详情图。
- 管理员登录失效：服务重启会清空内存 Session，重新登录即可。
