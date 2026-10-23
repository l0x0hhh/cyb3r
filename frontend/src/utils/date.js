// 借还页与管理端共用本地时间格式，缺失时间仍显示短横线。
export function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = value => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
