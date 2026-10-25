// 统一 API 传输：保留会话头、JSON/FormData 请求和原始响应语义。
const API_BASE = '';

export async function apiCall(method, url, body) {
  const opts = { method, credentials:'same-origin', headers: { 'Content-Type': 'application/json' } };
  const sessionId = localStorage.getItem('sessionId');
  if (sessionId) opts.headers['x-session-id'] = sessionId;

  if (body && !(body instanceof FormData)) {
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    delete opts.headers['Content-Type'];
    opts.body = body;
  }

  const res = await fetch(API_BASE + url, opts);
  return res.json();
}
