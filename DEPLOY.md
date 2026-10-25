# 独立部署

1. 在自己的服务器安装受支持的 Node.js 22.23+、npm、Nginx，获取本仓库源码。先备份现有数据库、上传目录、二维码和环境配置。
2. 用 node scripts/create-admin-hash.cjs 生成自己的管理员密码哈希；按 deploy/device-management.env.example 建立服务器环境文件，并生成独立 EMAIL_CONFIG_KEY（openssl rand -base64 32）。环境文件限制读取权限，绝不提交 Git。
3. 数据与图片放在独立持久化目录，代码更新时保持 DATA_DIR、UPLOAD_DIR、QR_DIR 不变。运行 npm ci 和 npm run build，采用 deploy/device-management.service 模板注册自己的服务。
4. 按 deploy/nginx.conf 配置自己的域名并申请 HTTPS。Node 监听 127.0.0.1，仅通过本机反向代理访问；TRUST_PROXY=true 只信任回环代理。
5. 核验 /borrow、/materials、/admin 及借还流程。不要在正在服务的生产端口运行集成测试。

deploy/setup-server.sh 是可选的首次初始化脚本，默认操作 /opt/device-management 和 /var/lib/device-management；仅适用于确认这些路径属于本次部署的环境。已有站点应先检查路径并制定迁移，不直接运行初始化脚本。

## 中国大陆 IP 限制

从 https://db-ip.com/db/download/ip-to-country-lite 获取最新 Country Lite CSV 并核对发布方校验值，运行 python scripts/build-mainland-ranges.py source.csv.gz mainland.conf。将结果安装到 /etc/nginx/geoip/ccs-mainland-ranges.conf，deploy/mainland-geo.conf 放在 Nginx http 上下文，在需要限制的网站 server 块 include deploy/mainland-access.conf 的安装路径。

CN IPv4/IPv6 放行，HK/MO/TW 与未知来源拒绝；保留本机健康检查和 ACME token 路径例外。先 nginx -t，再 reload；核验两种 IP 协议及境内外出口。IP 库需定期更新，并保留 DB-IP 署名。模板不会自动限制其他站点。

## 可选发布辅助脚本

deploy/update-from-git.sh 和 setup-cd.sh 为单独审查、安装的辅助工具。仓库地址指向本项目，未内置任何主机或密钥；需自行准备只读仓库密钥、主机校验和固定发布入口。CI 不调用这些工具。

失败时回退代码与依赖，保持现有业务数据库；不要用旧数据库覆盖上线后的新增记录。
