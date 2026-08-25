#!/usr/bin/env bash
set -Eeuo pipefail

# 删除“设备已经不存在”的指定设备借用记录，并在修改前自动备份。
# 用法：sudo bash remove-orphan-device-records.sh "Canon EOS 5D Mark IV"

DATA_DIR="${DATA_DIR:-/var/lib/device-management/data}"
TARGET_NAME="${1:-Canon EOS 5D Mark IV}"
DEVICES_FILE="${DATA_DIR}/devices.json"
RECORDS_FILE="${DATA_DIR}/records.json"

[[ "${EUID}" -eq 0 ]] || { echo "请使用 sudo 执行本脚本。" >&2; exit 1; }
[[ -f "${DEVICES_FILE}" ]] || { echo "找不到 ${DEVICES_FILE}" >&2; exit 1; }
[[ -f "${RECORDS_FILE}" ]] || { echo "找不到 ${RECORDS_FILE}" >&2; exit 1; }

BACKUP_FILE="${RECORDS_FILE}.backup-$(date '+%Y%m%d-%H%M%S')"
OWNER="$(stat -c '%u:%g' "${RECORDS_FILE}")"
MODE="$(stat -c '%a' "${RECORDS_FILE}")"
cp --preserve=all "${RECORDS_FILE}" "${BACKUP_FILE}"

node - "${DEVICES_FILE}" "${RECORDS_FILE}" "${TARGET_NAME}" <<'NODE'
const fs = require('fs');

const [, , devicesFile, recordsFile, targetName] = process.argv;
const devices = JSON.parse(fs.readFileSync(devicesFile, 'utf8'));
const records = JSON.parse(fs.readFileSync(recordsFile, 'utf8'));
const existingDeviceIds = new Set(devices.map(device => device.id));

const kept = [];
const removed = [];
for (const record of records) {
  const isTarget = record.deviceName === targetName || record.deviceModel === targetName;
  const deviceIsMissing = !existingDeviceIds.has(record.deviceId);
  if (isTarget && deviceIsMissing) removed.push(record);
  else kept.push(record);
}

const temporaryFile = `${recordsFile}.tmp-${process.pid}`;
fs.writeFileSync(temporaryFile, JSON.stringify(kept, null, 2) + '\n', 'utf8');
fs.renameSync(temporaryFile, recordsFile);

console.log(`已删除 ${removed.length} 条孤立借用记录。`);
for (const record of removed) {
  console.log(`- ${record.id} | ${record.deviceName} | ${record.borrowerName || '-'}`);
}
NODE

chown "${OWNER}" "${RECORDS_FILE}"
chmod "${MODE}" "${RECORDS_FILE}"

echo "备份文件：${BACKUP_FILE}"
