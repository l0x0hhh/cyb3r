const { apiBase } = require('../config');

function assetUrl(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${apiBase}${String(value).startsWith('/') ? value : `/${value}`}`;
}

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}${path}`,
      method,
      data,
      header: { 'content-type': 'application/json' },
      success(response) {
        const payload = response.data || {};
        if (response.statusCode >= 400 || payload.success === false) {
          reject(new Error(payload.message || `请求失败（${response.statusCode}）`));
          return;
        }
        resolve(payload);
      },
      fail(error) {
        reject(new Error(error.errMsg || '网络连接失败，请稍后重试'));
      }
    });
  });
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = { apiBase, assetUrl, request, formatDate };
