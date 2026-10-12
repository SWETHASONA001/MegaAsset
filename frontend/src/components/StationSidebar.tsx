import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { api } from '../lib/api'
import { usePolling } from '../lib/hooks'
import { cx, Tooltip } from './ui'

export interface StationActivity {
  id: number; code: string; name: string; lines: string[]; active_complaints: number; open_tickets: number
  pending_review: number; awaiting_verification: number; reopened: number; total_complaints: number
  highest_open_priority: string | null; severity: 'high' | 'medium' | 'low' | 'none'; documented_access_assets: number
}

const SEV_DOT: Record<string, string> = { high: 'bg-rose-400', medium: 'bg-amber-400', low: 'bg-sky-400', none: 'bg-slate-600' }
const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 }

/** Events that change station counts; other pages dispatch these after successful server responses. */
export const STATION_EVENTS = ['megaasset:complaint-created', 'megaasset:ticket-updated']
export const emitTicketUpdated = () => window.dispatchEvent(new Event('megaasset:ticket-updated'))

export function StationSidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const [items, setItems] = useState<StationActivity[] | null>(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('megaasset.stationsOpen') !== '0' } catch { return true } })
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState('')
  const load = useCallback(() => api<{ items: StationActivity[] }>('/api/stations/activity').then((r) => { setItems(r.items); setError(false) }).catch(() => setError(true)), [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    STATION_EVENTS.forEach((e) => window.addEventListener(e, load))
    return () => STATION_EVENTS.forEach((e) => window.removeEventListener(e, load))
  }, [load])
  usePolling(load, 30000)
  useEffect(() => { try { localStorage.setItem('megaasset.stationsOpen', open ? '1' : '0') } catch { /* ignore */ } }, [open])

  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.active_complaints - a.active_complaints || a.name.localeCompare(b.name)), [items])
  const active = sorted.filter((s) => s.active_complaints > 0)
  const totalActive = active.reduce((n, s) => n + s.active_complaints, 0)
  const visible = (showAll || q ? sorted : active).filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()))

  if (collapsed) {
    return totalActive > 0 ? (
      <Tooltip label={`${totalActive} active complaint(s) across ${active.length} station(s)`} side="right">
        <NavLink to="/app/stations" onClick={onNavigate} className="mx-auto mt-1 flex size-7 items-center justify-center rounded-full bg-amber-400/90 text-[11px] font-bold text-brand-950">{totalActive}</NavLink>
      </Tooltip>
    ) : null
  }
  return (
    <div className="mt-1">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-slate-400 hover:text-white" aria-expanded={open}>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Station activity
        {items && <span className="ml-auto rounded-full bg-white/10 px-1.5 text-[10px] text-slate-300">{totalActive} active</span>}
      </button>
      {open && (
        <div className="ml-2 border-l border-white/10 pl-2">
          {error && <div className="px-2 py-1.5 text-[11px] text-rose-300">Couldn't load station counts. <button className="underline" onClick={load}>Retry</button></div>}
          {!items && !error && <div className="space-y-1.5 px-2 py-1">{[0, 1, 2].map((i) => <div key={i} className="h-7 animate-pulse rounded bg-white/5" />)}</div>}
          {items && (
            <>
              {(showAll || q) && (
                <div className="relative mb-1 px-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-slate-500" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find station…" aria-label="Find station"
                    className="h-7 w-full rounded-md border border-white/10 bg-white/5 pl-7 pr-2 text-[12px] text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none" />
                </div>
              )}
              {visible.length === 0 && <div className="px-2 py-1.5 text-[11px] text-slate-400">{q ? 'No station matches.' : 'No active complaints at any station.'}</div>}
              <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1 thin-scroll">
                {visible.map((s) => (
                  <li key={s.id}>
                    <NavLink to={`/app/stations/${s.id}`} onClick={onNavigate}
                      title={`${s.name}: ${s.active_complaints} active complaint(s), ${s.open_tickets} open ticket(s)${s.pending_review ? `, ${s.pending_review} awaiting supervisor review` : ''}${s.highest_open_priority ? ` · highest priority ${s.highest_open_priority}` : ''}`}
                      className={({ isActive }) => cx('flex items-start gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors', isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                      <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', SEV_DOT[s.severity])} aria-label={`severity ${s.severity}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{s.name}</span>
                        <span className="block text-[10.5px] text-slate-400">
                          {s.active_complaints} active complaint{s.active_complaints === 1 ? '' : 's'} · {s.open_tickets} open ticket{s.open_tickets === 1 ? '' : 's'}
                          {s.pending_review > 0 && <> · {s.pending_review} in review</>}
                        </span>
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
              <button onClick={() => { setShowAll(!showAll); setQ('') }} className="mt-1 px-2 py-1 text-[11px] font-medium text-sky-300 hover:text-sky-200">
                {showAll ? 'Show only stations with active complaints' : `Show all ${items.length} stations`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
