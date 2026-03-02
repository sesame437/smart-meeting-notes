// 统一 API 层 - 唯一调用 fetch 的地方
const BASE = '/api'

async function handleResponse(response) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Request failed' } }))
    throw new Error(error.error?.message || error.message || 'Request failed')
  }

  // DELETE 请求可能返回 204 No Content
  if (response.status === 204) {
    return { success: true }
  }

  return response.json()
}

export const api = {
  get: (path) => fetch(`${BASE}${path}`).then(handleResponse),

  post: (path, body) => fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(handleResponse),

  patch: (path, body) => fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(handleResponse),

  delete: (path) => fetch(`${BASE}${path}`, { method: 'DELETE' }).then(handleResponse),

  // 文件上传专用（multipart/form-data）
  uploadFile: (path, formData) => fetch(`${BASE}${path}`, {
    method: 'POST',
    body: formData
  }).then(handleResponse)
}
