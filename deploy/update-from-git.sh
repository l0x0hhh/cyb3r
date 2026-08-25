#!/usr/bin/env bash
set -Eeuo pipefail

# Fast-forward the production source, build only what changed, and verify the service.

APP_DIR="${APP_DIR:-/opt/device-management}"
RUN_USER="${RUN_USER:-deviceapp}"
REPO_URL="${REPO_URL:-git@github.com:l0x0hhh/cyb3r.git}"
BRANCH="${DEPLOY_BRANCH:-main}"
PERSIST_DIR="${PERSIST_DIR:-/var/lib/device-management}"
SSH_DIR="${SSH_DIR:-${PERSIST_DIR}/.ssh}"
KEY_FILE="${KEY_FILE:-${SSH_DIR}/github_deploy}"
KNOWN_HOSTS="${KNOWN_HOSTS:-${SSH_DIR}/known_hosts}"
SERVICE_NAME="${SERVICE_NAME:-device-management}"
HEALTH_BASE_URL="${HEALTH_BASE_URL:-http://127.0.0.1:3000}"

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

[[ "${EUID}" -eq 0 ]] || fail "Run this script with sudo."

for command_name in sudo git namei systemctl curl; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "Missing required command: ${command_name}"
done

[[ -d "${APP_DIR}" ]] || fail "Application directory does not exist: ${APP_DIR}"
[[ -d "${APP_DIR}/.git" ]] || fail "${APP_DIR} is not connected to a Git repository yet."
[[ -r "${KEY_FILE}" ]] || fail "GitHub deploy key is not readable: ${KEY_FILE}"
[[ -r "${KNOWN_HOSTS}" ]] || fail "GitHub known_hosts file is not readable: ${KNOWN_HOSTS}"

export GIT_SSH_COMMAND="ssh -i ${KEY_FILE} -o IdentitiesOnly=yes -o UserKnownHostsFile=${KNOWN_HOSTS} -o StrictHostKeyChecking=yes"

as_app() {
  sudo -u "${RUN_USER}" env \
    HOME="${PERSIST_DIR}" \
    GIT_SSH_COMMAND="${GIT_SSH_COMMAND}" \
    "$@"
}

git_cmd() {
  as_app git -C "${APP_DIR}" "$@"
}

log "Checking repository and production workspace"
[[ "$(git_cmd rev-parse --is-inside-work-tree 2>/dev/null)" == "true" ]] || fail "Invalid Git worktree: ${APP_DIR}"

actual_remote="$(git_cmd remote get-url origin 2>/dev/null || true)"
[[ "${actual_remote}" == "${REPO_URL}" ]] || fail "Unexpected origin URL: ${actual_remote:-<missing>}"

current_branch="$(git_cmd symbolic-ref --short HEAD 2>/dev/null || true)"
[[ "${current_branch}" == "${BRANCH}" ]] || fail "Expected branch ${BRANCH}, found ${current_branch:-detached HEAD}."

workspace_status="$(git_cmd status --porcelain)"
[[ -z "${workspace_status}" ]] || fail "Production worktree is not clean. Resolve local changes before deploying."

as_app test -r "${APP_DIR}/package.json" || fail "${RUN_USER} cannot read ${APP_DIR}/package.json"
namei -l "${APP_DIR}/package.json"

if [[ -f "${APP_DIR}/frontend/index.html" ]]; then
  as_app test -r "${APP_DIR}/frontend/index.html" || fail "${RUN_USER} cannot read ${APP_DIR}/frontend/index.html"
  namei -l "${APP_DIR}/frontend/index.html"
fi

before_commit="$(git_cmd rev-parse HEAD)"
log "Fetching origin/${BRANCH}"
git_cmd fetch --prune origin "${BRANCH}"
target_ref="origin/${BRANCH}"
target_commit="$(git_cmd rev-parse --verify "${target_ref}")"

[[ "${before_commit}" != "${target_commit}" ]] || {
  log "Already up to date at ${before_commit}"
  exit 0
}

git_cmd merge-base --is-ancestor "${before_commit}" "${target_commit}" \
  || fail "Remote history is not a fast-forward from ${before_commit}; no files were changed."

for forbidden_path in data uploads public/qrcodes frontend/dist node_modules .env .env.local .env.production; do
  tracked_forbidden="$(git_cmd ls-tree -r --name-only "${target_ref}" -- "${forbidden_path}" || true)"
  [[ -z "${tracked_forbidden}" ]] || fail "Remote commit tracks protected path ${forbidden_path}; deployment stopped."
done

changed_files="$(git_cmd diff --name-only "${before_commit}" "${target_commit}")"
needs_npm_ci=false
needs_build=false
needs_restart=false

if [[ -n "${changed_files}" ]]; then
  while IFS= read -r changed_path; do
    case "${changed_path}" in
      package.json|package-lock.json)
        needs_npm_ci=true
        needs_build=true
        needs_restart=true
        ;;
      server.js|email-service.js)
        needs_restart=true
        ;;
      frontend/*|vite.config.js|public/*)
        needs_build=true
        ;;
      deploy/device-management.service|deploy/nginx.conf|deploy/setup-server.sh)
        log "System configuration source changed: ${changed_path}; live system config is not applied by this script."
        ;;
    esac
  done <<< "${changed_files}"
fi

[[ -x "${APP_DIR}/node_modules/.bin/vite" ]] || {
  needs_npm_ci=true
  needs_build=true
  needs_restart=true
}

log "Fast-forwarding ${BRANCH} from ${before_commit} to ${target_commit}"
git_cmd merge --ff-only "${target_ref}"

if [[ "${needs_npm_ci}" == true ]]; then
  log "Installing locked Node.js dependencies"
  as_app npm ci --no-audit --no-fund
fi

if [[ "${needs_restart}" == true ]]; then
  as_app node --check "${APP_DIR}/server.js"
  if [[ -f "${APP_DIR}/email-service.js" ]]; then
    as_app node --check "${APP_DIR}/email-service.js"
  fi
fi

if [[ "${needs_build}" == true ]]; then
  log "Building frontend"
  as_app npm run build
  [[ -f "${APP_DIR}/frontend/dist/index.html" ]] || fail "Frontend build did not produce frontend/dist/index.html"
fi

if [[ "${needs_restart}" == true ]]; then
  log "Restarting ${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
fi

systemctl is-active --quiet "${SERVICE_NAME}" || {
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
  journalctl -u "${SERVICE_NAME}" -n 80 --no-pager || true
  fail "${SERVICE_NAME} is not active."
}

for health_path in /borrow /admin; do
  curl --fail --silent --show-error --max-time 15 \
    -o /dev/null "${HEALTH_BASE_URL}${health_path}" \
    || fail "Health check failed: ${HEALTH_BASE_URL}${health_path}"
done

log "Deployment completed at ${target_commit}"
if [[ "${needs_build}" != true && "${needs_restart}" != true ]]; then
  log "Only documentation, tests, or deployment metadata changed; no build or restart was required."
fi
