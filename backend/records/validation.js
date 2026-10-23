// 借还校验与旧字段兼容：保留手机号规范化和历史记录读取规则。
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isFullPhone(phone) {
  return /^1\d{10}$/.test(normalizePhone(phone));
}

function getRecordMajor(record) {
  return String(record?.major ?? record?.department ?? '').trim();
}

function getRecordPurpose(record) {
  return String(record?.purpose ?? record?.notes ?? '').trim();
}

function withRecordCompatibility(record) {
  return {
    ...record,
    major: getRecordMajor(record),
    purpose: getRecordPurpose(record)
  };
}

module.exports = { normalizePhone, isFullPhone, getRecordMajor, getRecordPurpose, withRecordCompatibility };
