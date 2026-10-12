export function fmtDate(iso?: string | null, withTime = true): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('en-IN', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' })
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return fmtDate(iso, false)
}

export function fmtNum(n?: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-IN')
}

export function compact(n?: number | null): string {
  if (n === null || n === undefined) return '—'
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(1)} L`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

export function bytes(n?: number | null): string {
  if (!n) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}

export const titleCase = (s?: string | null) => (s ?? '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
