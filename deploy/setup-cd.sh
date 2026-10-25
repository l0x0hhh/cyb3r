#!/usr/bin/env bash
# 一次性接入 CI/CD：安装 root 固定入口及仅能触发发布的 SSH 账号，不修改运行中的应用。
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
[[ "${EUID}" -eq 0 ]] || fail 'Run with sudo.'
[[ "$#" -eq 1 && -f "$1" ]] || fail 'Usage: sudo bash setup-cd.sh <deployment-public-key.pub>'
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for command_name in git curl node npm flock sudo visudo ssh-keygen; do
  command -v "${command_name}" >/dev/null || fail "Install required command first: ${command_name}"
done
[[ -f "${script_dir}/update-from-git.sh" ]] || fail 'Missing reviewed release script.'
bash -n "${script_dir}/update-from-git.sh"
id deviceapp >/dev/null
[[ -f /var/lib/device-management/data/device-management.sqlite ]] || fail 'Production database is missing.'
[[ -r /etc/device-management.env ]] || fail 'Production environment file is missing.'
sudo -u deviceapp test -r /var/lib/device-management/.ssh/github_deploy || fail 'GitHub read-only key is missing.'
sudo -u deviceapp test -r /var/lib/device-management/.ssh/known_hosts || fail 'GitHub known_hosts is missing.'
[[ -f /etc/ssh/ssh_host_ed25519_key.pub ]] || fail 'Missing server ED25519 public host key.'

ssh-keygen -l -f "$1" >/dev/null
read -r key_type key_body _ < "$1"
[[ "${key_type}" == ssh-ed25519 && "${key_body}" =~ ^[A-Za-z0-9+/=]+$ ]] || fail 'Supply one ED25519 public key, without authorized_keys options.'
[[ "$(awk 'NF {n++} END {print n+0}' "$1")" -eq 1 ]] || fail 'Supply exactly one public key.'

if ! id device-deploy >/dev/null 2>&1; then
  useradd --create-home --user-group --shell /bin/bash --password '*' device-deploy
fi
[[ "$(id -u device-deploy)" -ne 0 ]] || fail 'Unexpected deployment UID.'
[[ "$(getent passwd device-deploy | cut -d: -f6)" == /home/device-deploy ]] || fail 'Unexpected deployment home.'
[[ "$(id -Gn device-deploy)" == device-deploy ]] || fail 'Deployment account has extra groups; inspect before continuing.'

install -o root -g root -m 0755 "${script_dir}/update-from-git.sh" /usr/local/sbin/device-management-deploy
install -d -o root -g root -m 0755 /home/device-deploy /home/device-deploy/.ssh

# 不解释来自 SSH 的任意 shell 内容；只接受 deploy 和一个完整 SHA。
cat > /usr/local/bin/device-management-cd-command <<'WRAPPER'
#!/usr/bin/env bash
# SSH 固定入口：拒绝交互终端、文件上传和任意命令。
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  exec sudo -n /usr/local/sbin/device-management-deploy "${BASH_REMATCH[1]}"
fi
echo 'Only deploy <40-character commit SHA> is allowed.' >&2
exit 1
WRAPPER
chown root:root /usr/local/bin/device-management-cd-command
chmod 0755 /usr/local/bin/device-management-cd-command

printf 'restrict,command="/usr/local/bin/device-management-cd-command" %s %s device-management-cd\n' \
  "${key_type}" "${key_body}" > /home/device-deploy/.ssh/authorized_keys
chown root:root /home/device-deploy/.ssh/authorized_keys
chmod 0644 /home/device-deploy/.ssh/authorized_keys

sudoers_temp="$(mktemp /etc/sudoers.d/.device-management-cd.XXXXXX)"
trap 'rm -f -- "${sudoers_temp}"' EXIT
printf 'device-deploy ALL=(root) NOPASSWD: /usr/local/sbin/device-management-deploy *\n' > "${sudoers_temp}"
visudo -cf "${sudoers_temp}"
install -o root -g root -m 0440 "${sudoers_temp}" /etc/sudoers.d/device-management-cd

printf '\nCI/CD entry installed. The current application was not restarted.\n'
printf 'DEPLOY_HOST = server.example.com\nDEPLOY_USER = device-deploy (fixed in workflow)\n'
printf '\nDEPLOY_KNOWN_HOSTS (copy this public line into GitHub secret):\n'
awk -v host="${DEPLOY_HOST:?Set DEPLOY_HOST to your server hostname}" '{print host " " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
printf '\nServer host fingerprint:\n'
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
