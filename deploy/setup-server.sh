#!/usr/bin/env bash
set -Eeuo pipefail

# 一次性初始化学院设备管理服务。
# 用法：sudo bash /opt/device-management/deploy/setup-server.sh

APP_DIR="/opt/device-management"
RUN_USER="deviceapp"
PERSIST_DIR="/var/lib/device-management"
ENV_FILE="/etc/device-management.env"
SERVICE_FILE="/etc/systemd/system/device-management.service"
NGINX_SITE="/etc/nginx/sites-available/device-management"

log() { printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"; }
fail() { printf '\n错误：%s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || fail "请使用 sudo 执行：sudo bash $0"
[[ -d "${APP_DIR}" ]] || fail "找不到 ${APP_DIR}，请先上传整个项目目录。"
[[ -f "${APP_DIR}/server.js" ]] || fail "${APP_DIR}/server.js 不存在，项目文件不完整。"

read -r -p "请输入访问域名（例如 device.example.com；没有域名可填服务器 IP）：" DOMAIN
[[ -n "${DOMAIN}" ]] || fail "域名不能为空。"
[[ "${DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] || fail "域名只能包含字母、数字、点和连字符。"
IS_IP=false
if [[ "${DOMAIN}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  IS_IP=true
fi

read -r -p "请输入管理员邮箱（申请 HTTPS 时填写；暂不申请可直接回车）：" CERT_EMAIL

read -r -s -p "请输入管理员密码（至少 16 位，不会显示）：" ADMIN_PASSWORD
printf '\n'
[[ "${#ADMIN_PASSWORD}" -ge 16 ]] || fail "管理员密码至少需要 16 位。"
[[ "${ADMIN_PASSWORD}" =~ ^[A-Za-z0-9._@%+=:,!?-]+$ ]] || fail "管理员密码请只使用英文字母、数字和 . _ @ % + = : , ! ? -，不要包含空格。"

log "安装系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update
APT_PACKAGES=(nginx curl ca-certificates)
if [[ "${IS_IP}" != true ]]; then
  APT_PACKAGES+=(certbot python3-certbot-nginx)
fi
apt-get install -y "${APT_PACKAGES[@]}"

if ! command -v node >/dev/null 2>&1; then
  fail "服务器未安装 Node.js。请先安装 Node.js 22，再重新执行本脚本。"
fi

log "创建运行用户和持久化目录"
if ! id -u "${RUN_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${RUN_USER}"
fi

install -d -o "${RUN_USER}" -g "${RUN_USER}" -m 750 \
  "${PERSIST_DIR}" \
  "${PERSIST_DIR}/data" \
  "${PERSIST_DIR}/uploads" \
  "${PERSIST_DIR}/qrcodes"

# 首次部署时迁移项目目录中的旧数据；目标已有文件时不覆盖。
if [[ -d "${APP_DIR}/data" ]]; then
  cp -an "${APP_DIR}/data/." "${PERSIST_DIR}/data/"
fi
if [[ -d "${APP_DIR}/uploads" ]]; then
  cp -an "${APP_DIR}/uploads/." "${PERSIST_DIR}/uploads/"
fi
if [[ -d "${APP_DIR}/public/qrcodes" ]]; then
  cp -an "${APP_DIR}/public/qrcodes/." "${PERSIST_DIR}/qrcodes/"
fi

chown -R "${RUN_USER}:${RUN_USER}" "${APP_DIR}" "${PERSIST_DIR}"
chmod -R u+rwX,go-rwx "${PERSIST_DIR}"

log "安装 Node.js 依赖并构建前端"
cd "${APP_DIR}"
if [[ -f package-lock.json ]]; then
  # 构建阶段需要 vite（devDependency），因此这里保留开发依赖。
  sudo -u "${RUN_USER}" npm ci
else
  sudo -u "${RUN_USER}" npm install
fi
sudo -u "${RUN_USER}" npm run build
if [[ -d test ]]; then
  sudo -u "${RUN_USER}" npm test
fi

BASE_URL="http://${DOMAIN}"

log "写入生产环境配置"
umask 077
cat > "${ENV_FILE}" <<EOF
NODE_ENV=production
PORT=3000
ADMIN_PASSWORD=${ADMIN_PASSWORD}
APP_BASE_URL=${BASE_URL}
TRUST_PROXY=true
DATA_DIR=${PERSIST_DIR}/data
UPLOAD_DIR=${PERSIST_DIR}/uploads
QR_DIR=${PERSIST_DIR}/qrcodes
EOF
chown root:"${RUN_USER}" "${ENV_FILE}"
chmod 640 "${ENV_FILE}"
unset ADMIN_PASSWORD

log "注册并启动 systemd 服务"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=College Device Management
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${PERSIST_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable device-management
systemctl restart device-management || systemctl start device-management
sleep 1
if ! systemctl is-active --quiet device-management; then
  journalctl -u device-management -n 80 --no-pager || true
  fail "device-management 服务启动失败。"
fi
curl -fsS http://127.0.0.1:3000/admin >/dev/null

log "配置 Nginx 反向代理"
cat > "${NGINX_SITE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sfn "${NGINX_SITE}" /etc/nginx/sites-enabled/device-management
nginx -t
systemctl reload nginx

if [[ "${IS_IP}" != true && "${DOMAIN}" != "localhost" && "${DOMAIN}" != "${HOSTNAME}" ]]; then
  if command -v certbot >/dev/null 2>&1; then
    read -r -p "域名已指向本服务器并开放 80 端口吗？输入 yes 自动申请 HTTPS（其他内容跳过）：" ENABLE_HTTPS
    if [[ "${ENABLE_HTTPS}" == "yes" ]]; then
      [[ -n "${CERT_EMAIL}" ]] || fail "申请 HTTPS 证书需要填写一个可接收通知的邮箱。"
      certbot --nginx --non-interactive --agree-tos --redirect -m "${CERT_EMAIL}" -d "${DOMAIN}"
      # 证书申请成功后，二维码和前端接口改用 HTTPS 地址。
      sed -i "s#^APP_BASE_URL=.*#APP_BASE_URL=https://${DOMAIN}#" "${ENV_FILE}"
      systemctl restart device-management
      BASE_URL="https://${DOMAIN}"
    fi
  else
    log "未安装 certbot，暂不申请 HTTPS；可稍后执行：sudo apt-get install -y certbot python3-certbot-nginx"
  fi
fi

log "完成，服务状态如下"
systemctl --no-pager --full status device-management || true
printf '\n访问地址：%s\n' "${BASE_URL}"
printf '查看日志：sudo journalctl -u device-management -f\n'
printf '持久化目录：%s\n' "${PERSIST_DIR}"
