#!/usr/bin/env bash
# CI/CD 发布：只部署已验证的提交，独立构建、串行切换，失败仅回退代码。
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 022

# 由 setup-cd.sh 安装到 root 固定入口；不从仓库重新执行自身。
APP_DIR=/opt/device-management
RELEASES_DIR=/opt/device-management-releases
REPO_DIR=/var/cache/device-management/repository.git
PERSIST_DIR=/var/lib/device-management
RUN_USER=deviceapp
SERVICE_NAME=device-management
REPO_URL=git@github.com:ltyyyyy1017/Campus-Equipment-and-Supplies-Management-System.git
KEY_FILE=/var/lib/device-management/.ssh/github_deploy
KNOWN_HOSTS=/var/lib/device-management/.ssh/known_hosts
HEALTH_BASE_URL=http://127.0.0.1:3000
HEALTH_RETRY_COUNT=10
HEALTH_RETRY_DELAY=1

log() { printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
validate_commit() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

as_app() {
  local work_dir="$1"
  shift
  sudo -u "${RUN_USER}" env -i \
    PATH=/usr/bin:/bin HOME="${PERSIST_DIR}" \
    GIT_SSH_COMMAND="ssh -i ${KEY_FILE} -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile=${KNOWN_HOSTS} -o StrictHostKeyChecking=yes" \
    bash -c 'cd "$1" && shift && exec "$@"' bash "${work_dir}" "$@"
}
git_cmd() { as_app "${REPO_DIR}" git --git-dir="${REPO_DIR}" "$@"; }

# 只接受 Git 源码；生成物、业务数据及环境密钥不能进入发布版本。
check_source_paths() {
  local file
  while IFS= read -r -d '' file; do
    case "${file}" in
      data|data/*|uploads|uploads/*|public/qrcodes|public/qrcodes/*|frontend/dist|frontend/dist/*|node_modules|node_modules/*)
        printf 'Protected runtime path in source: %s\n' "${file}" >&2
        return 1 ;;
    esac
    case "${file##*/}" in
      .env.example) ;;
      .env|.env.*|*.pem|*.key|*.p12|*.pfx)
        printf 'Secret path in source: %s\n' "${file}" >&2
        return 1 ;;
    esac
  done
}

health_check() {
  local health_path
  for health_path in /borrow /admin /api/categories; do
    curl --noproxy '*' --fail --silent --show-error --max-time 10 \
      --retry "${HEALTH_RETRY_COUNT}" --retry-delay "${HEALTH_RETRY_DELAY}" \
      --retry-connrefused --retry-all-errors --retry-max-time 30 \
      -o /dev/null "${HEALTH_BASE_URL}${health_path}" || return 1
  done
  systemctl is-active --quiet "${SERVICE_NAME}"
}

switch_link() {
  local destination="$1" temporary="${APP_DIR}.next.$$"
  ln -s -- "${destination}" "${temporary}" || return 1
  if ! mv -Tf -- "${temporary}" "${APP_DIR}"; then
    rm -f -- "${temporary}"
    return 1
  fi
}

restore_previous() {
  systemctl stop "${SERVICE_NAME}" || return 1
  if [[ -d "${previous_dir}" ]]; then
    switch_link "${previous_dir}" || return 1
  elif [[ -d "${APP_DIR}" && ! -L "${APP_DIR}" ]]; then
    # 首次发布在旧目录移动之前失败，原目录仍可直接启动。
    :
  else
    printf 'Previous release is unavailable: %s\n' "${previous_dir}" >&2
    return 1
  fi
  systemctl start "${SERVICE_NAME}" || return 1
  health_check || return 1
}

on_exit() {
  local result=$?
  trap - EXIT INT TERM HUP
  if [[ "${result}" -ne 0 && "${switch_started}" == true ]]; then
    log 'Release failed; restoring previous code and dependencies (business data is unchanged by rollback)'
    if restore_previous; then
      log "Previous release restored: ${previous_dir}"
    else
      printf '\nROLLBACK FAILED: inspect systemctl status %s and release links immediately.\n' "${SERVICE_NAME}" >&2
    fi
  fi
  exit "${result}"
}

main() {
  [[ "${EUID}" -eq 0 ]] || fail 'Run the installed entry with sudo.'
  [[ "$#" -eq 1 ]] && validate_commit "$1" || fail 'Usage: device-management-deploy <40-character commit SHA>'
  local target_commit="$1" main_commit before_commit='' current_name path_list
  local release_dir legacy_dir
  for command_name in sudo git flock systemctl curl node npm namei mktemp; do
    command -v "${command_name}" >/dev/null || fail "Missing command: ${command_name}"
  done

  # 与 GitHub 并发组配合，也阻止手工入口同时切换目录。
  exec 9>/run/lock/device-management-deploy.lock
  flock -n 9 || fail 'Another deployment is running; retry after it finishes.'
  switch_started=false
  previous_dir=''
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP

  [[ -d "${APP_DIR}" ]] || fail "Missing application: ${APP_DIR}"
  [[ -f "${PERSIST_DIR}/data/device-management.sqlite" ]] || fail 'Production database is missing; deployment will not create replacement data.'
  [[ -r /etc/device-management.env ]] || fail 'Production environment file is missing.'
  [[ "$(systemctl show -p User --value "${SERVICE_NAME}")" == "${RUN_USER}" ]] || fail 'Unexpected service user.'
  [[ "$(systemctl show -p WorkingDirectory --value "${SERVICE_NAME}")" == "${APP_DIR}" ]] || fail 'Unexpected service working directory.'
  as_app / test -r "${KEY_FILE}" || fail 'GitHub read-only deploy key is missing or unreadable.'
  as_app / test -r "${KNOWN_HOSTS}" || fail 'GitHub known_hosts is missing or unreadable.'
  systemctl is-active --quiet "${SERVICE_NAME}" || fail 'Production service is inactive; inspect it before deploying.'

  [[ ! -L "${RELEASES_DIR}" && ! -L /var/cache/device-management && ! -L "${REPO_DIR}" ]] || fail 'Unexpected symlink in deployment storage.'
  install -d -o root -g root -m 0755 "${RELEASES_DIR}" /var/cache/device-management
  if [[ ! -d "${REPO_DIR}" ]]; then
    install -d -o "${RUN_USER}" -g "${RUN_USER}" -m 0750 "${REPO_DIR}"
    as_app "${REPO_DIR}" git init --bare "${REPO_DIR}"
    git_cmd remote add origin "${REPO_URL}"
  fi
  [[ "$(git_cmd remote get-url origin)" == "${REPO_URL}" ]] || fail 'Unexpected repository origin.'
  log 'Fetching main using the read-only GitHub key'
  git_cmd fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
  main_commit="$(git_cmd rev-parse --verify refs/remotes/origin/main)"
  git_cmd cat-file -e "${target_commit}^{commit}" || fail 'Requested commit was not fetched.'
  git_cmd merge-base --is-ancestor "${target_commit}" "${main_commit}" || fail 'Requested commit is outside main history.'

  if [[ -L "${APP_DIR}" ]]; then
    previous_dir="$(readlink -f -- "${APP_DIR}")"
    [[ "${previous_dir}" == "${RELEASES_DIR}/"* ]] || fail 'Current release points outside deployment storage.'
    current_name="${previous_dir##*/}"
    if [[ "${current_name}" =~ ^([0-9a-f]{40})- ]]; then before_commit="${BASH_REMATCH[1]}"; fi
  else
    # 首次保留整份旧源码和依赖；不要求迁移备份中的工作区干净。
    if [[ -d "${APP_DIR}/.git" ]]; then before_commit="$(as_app "${APP_DIR}" git rev-parse HEAD)"; fi
  fi

  if [[ -n "${before_commit}" ]]; then
    if [[ "${before_commit}" == "${target_commit}" && -L "${APP_DIR}" ]]; then
      health_check || fail 'Already-current release failed health checks.'
      log "Already deployed: ${target_commit}"
      return 0
    fi
    if [[ "${before_commit}" != "${target_commit}" ]]; then
      if git_cmd merge-base --is-ancestor "${target_commit}" "${before_commit}"; then
        log "Skipping stale deployment ${target_commit}; newer code is already live."
        return 0
      fi
      git_cmd merge-base --is-ancestor "${before_commit}" "${target_commit}" || fail 'Production and requested histories diverged; review manually.'
    fi
  fi

  [[ "$(df -Pk "${RELEASES_DIR}" | awk 'NR==2 {print $4}')" -ge 1048576 ]] || fail 'Less than 1 GiB free; review retained releases before deployment.'
  path_list="$(mktemp /tmp/device-release-paths.XXXXXX)"
  git_cmd ls-tree -rz --name-only "${target_commit}" > "${path_list}"
  if ! check_source_paths < "${path_list}"; then
    rm -f -- "${path_list}"
    fail 'Protected paths found; no live code was changed.'
  fi
  rm -f -- "${path_list}"

  release_dir="$(mktemp -d "${RELEASES_DIR}/${target_commit}-$(date -u +%Y%m%dT%H%M%S)-XXXXXX")"
  chown "${RUN_USER}:${RUN_USER}" "${release_dir}"
  chmod 0755 "${release_dir}"
  log "Preparing exact commit ${target_commit} in ${release_dir}"
  git_cmd archive --format=tar "${target_commit}" | as_app "${release_dir}" tar -xf -
  namei -l "${release_dir}/package.json"
  namei -l "${release_dir}/frontend/index.html"
  as_app "${release_dir}" test -r package-lock.json
  as_app "${release_dir}" test -r frontend/index.html
  as_app "${release_dir}" npm ci --include=dev --no-audit --no-fund
  as_app "${release_dir}" node --check server.js
  as_app "${release_dir}" node --check db/repository.js
  as_app "${release_dir}" npm run build
  as_app "${release_dir}" test -r frontend/dist/index.html

  # 准备完成后才停当前进程；实际数据和 /etc 均不复制或覆盖。
  legacy_dir="${RELEASES_DIR}/legacy-$(date -u +%Y%m%dT%H%M%S)-$$"
  if [[ ! -L "${APP_DIR}" ]]; then previous_dir="${legacy_dir}"; fi
  switch_started=true
  systemctl stop "${SERVICE_NAME}"
  if [[ ! -L "${APP_DIR}" ]]; then mv -T -- "${APP_DIR}" "${legacy_dir}"; fi
  switch_link "${release_dir}"
  systemctl start "${SERVICE_NAME}"
  health_check || fail 'New release failed HTTP/API checks.'
  switch_started=false
  log "Deployment completed at ${target_commit}"
  log "Previous release retained: ${previous_dir}; no database rollback was performed."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
