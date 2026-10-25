// 只保存界面选项；不接受姓名、手机号、密码或借用凭证。
const rules = {
  adminTab: value => typeof value === 'string' && /^(devices|records|all-records|archived|categories|statistics|operation-logs|email-notifications|admin-management|materials-(inventory|entry|loans|returns|entries|ledger))$/.test(value),
  adminDeviceViewMode: value => ['card','list'].includes(value),
  adminNavigationCollapsed: value => typeof value === 'boolean',
  deviceMode: value => ['borrow','return'].includes(value),
  deviceCategory: value => typeof value === 'string' && value.length <= 80,
  materialPage: value => ['catalog','mine','entry'].includes(value),
  materialCategory: value => typeof value === 'string' && value.length <= 80,
  materialType: value => ['all','consumable','reusable'].includes(value),
  materialOnlyAvailable: value => typeof value === 'boolean'
};
function read() {
  if (typeof document === 'undefined') return {};
  try {
    const cookie = document.cookie.split(';').map(item=>item.trim()).find(item=>item.startsWith('ccs_preferences='));
    const data = cookie ? JSON.parse(decodeURIComponent(cookie.slice(16))) : {};
    return Object.fromEntries(Object.entries(data).filter(([key,value])=>Object.hasOwn(rules,key) && rules[key](value)));
  } catch { return {}; }
}
export function preference(key, fallback) { return read()[key] ?? fallback; }
export function savePreference(key, value) {
  if (typeof document === 'undefined' || !Object.hasOwn(rules,key) || !rules[key](value)) return;
  const data = {...read(),[key]:value};
  document.cookie = `ccs_preferences=${encodeURIComponent(JSON.stringify(data))}; Path=/; Max-Age=31536000; SameSite=Lax${globalThis.location?.protocol === 'https:' ? '; Secure' : ''}`;
}
