const TOKEN_KEY = 'megaasset.token'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

function detailMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) return d.map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: string }).msg) : String(x))).join('; ')
  }
  return fallback
}

export async function api<T = unknown>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(opts.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let body = opts.body
  if (opts.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(opts.json) }
  const res = await fetch(path, { ...opts, headers, body })
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    setToken(null)
    window.dispatchEvent(new Event('megaasset:logout'))
  }
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new ApiError(res.status, detailMessage(data, `Request failed (${res.status})`))
  return data as T
}

export function fileUrl(documentId: number, page?: number | null) {
  const t = getToken() ?? ''
  return `/api/documents/${documentId}/file?token=${encodeURIComponent(t)}${page ? `#page=${page}` : ''}`
}

export function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)))
    else sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Streams Server-Sent Events from a POST endpoint. */
export async function streamSSE(path: string, json: unknown, onEvent: (e: Record<string, unknown>) => void, signal?: AbortSignal) {
  const token = getToken()
  const res = await fetch(path, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(json),
  })
  if (!res.ok || !res.body) {
    const t = await res.text()
    let msg = `Request failed (${res.status})`
    try { msg = detailMessage(JSON.parse(t), msg) } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (line) { try { onEvent(JSON.parse(line.slice(6))) } catch { /* partial */ } }
    }
  }
}
