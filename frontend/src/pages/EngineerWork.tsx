import { AlertTriangle, ClipboardList, HardHat, Inbox, Play, RotateCcw, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { emitTicketUpdated } from '../components/StationSidebar'
import { Badge, Button, Card, cx, EmptyState, ErrorState, LoadingBlock, PageHeader, PriorityBadge, Select, Stat, StatusBadge, Tabs, useToast } from '../components/ui'
import { api, qs } from '../lib/api'
import { fmtDate, titleCase } from '../lib/format'
import { useApi } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
type View = 'assigned' | 'available' | 'returned' | 'submitted'

function age(h: number) { return h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d` }

export default function EngineerWork() {
  const [view, setView] = useState<View>('assigned')
  const [f, setF] = useState({ station_id: '', category: '', priority: '', min_age_days: '', asset_type: '' })
  const { data, error, loading, reload } = useApi<any>(`/api/work/queue${qs(f)}`, [])
  const { data: stations } = useApi<{ items: { id: number; name: string }[] }>('/api/stations')
  const { data: meta } = useApi<any>('/api/tickets/meta')
  const [busy, setBusy] = useState<number | null>(null)
  const toast = useToast()
  const nav = useNavigate()
  useEffect(() => { const h = () => reload(true); window.addEventListener('megaasset:ticket-updated', h); window.addEventListener('megaasset:complaint-created', h)
    return () => { window.removeEventListener('megaasset:ticket-updated', h); window.removeEventListener('megaasset:complaint-created', h) } }, [reload])

  const start = async (t: any) => {
    setBusy(t.id)
    try { await api(`/api/tickets/${t.id}/actions`, { method: 'POST', json: { action: 'start_work', expected_version: t.version } }); toast({ tone: 'success', message: `${t.ticket_code}: work started` }); emitTicketUpdated(); nav(`/app/tickets/${t.id}`) }
    catch (e) { toast({ tone: 'error', message: (e as Error).message }); reload(true) } finally { setBusy(null) }
  }
  const rows: any[] = data?.[view] ?? []
  return (
    <div>
      <PageHeader eyebrow="Engineer workspace" title="My work" description="Tickets assigned to you, unassigned tickets you can take, and work returned by a supervisor. Starting work records the assignment; completed work goes to a supervisor for review." />
      {error ? <ErrorState message={error} onRetry={reload} /> : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Assigned to me (active)" value={data?.assigned.length ?? '—'} icon={<HardHat className="size-4" />} />
            <Stat label="Available to take" value={data?.available.length ?? '—'} icon={<Inbox className="size-4" />} />
            <Stat label="Returned by supervisor" value={data?.returned.length ?? '—'} icon={<RotateCcw className="size-4" />} tone={data?.returned.length ? 'warn' : 'default'} />
            <Stat label="Awaiting review" value={data?.submitted.length ?? '—'} icon={<Send className="size-4" />} />
          </div>
          <Card padded={false} className="mt-6">
            <div className="px-4 pt-2"><Tabs value={view} onChange={setView} tabs={[
              { value: 'assigned', label: 'Assigned to me', count: data?.assigned.length }, { value: 'available', label: 'Available', count: data?.available.length },
              { value: 'returned', label: 'Returned', count: data?.returned.length }, { value: 'submitted', label: 'Submitted for review', count: data?.submitted.length }]} /></div>
            <div className="grid gap-2 border-b border-line bg-slate-50/50 p-3 sm:grid-cols-3 lg:grid-cols-5">
              <Select aria-label="Station" value={f.station_id} onChange={(e) => setF({ ...f, station_id: e.target.value })}><option value="">All stations</option>{stations?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              <Select aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All categories</option>{meta?.categories.map((c: any) => <option key={c.value} value={c.value}>{c.en}</option>)}</Select>
              <Select aria-label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">All priorities</option>{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</Select>
              <Select aria-label="Reported asset type" value={f.asset_type} onChange={(e) => setF({ ...f, asset_type: e.target.value })}><option value="">Any reported asset</option>{['lift', 'escalator', 'accessibility_ramp', 'station_entrance'].map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}</Select>
              <Select aria-label="Minimum age" value={f.min_age_days} onChange={(e) => setF({ ...f, min_age_days: e.target.value })}><option value="">Any age</option><option value="1">Older than 1 day</option><option value="3">Older than 3 days</option><option value="7">Older than 7 days</option></Select>
            </div>
            {loading && !data ? <div className="p-4"><LoadingBlock /></div> : rows.length === 0 ? (
              <div className="p-6"><EmptyState icon={<ClipboardList className="size-6" />} title={view === 'available' ? 'Nothing available to take' : view === 'returned' ? 'No work returned' : view === 'submitted' ? 'Nothing awaiting review' : 'No active tickets assigned to you'} description="Counts come from real ticket records; filters apply to all tabs." /></div>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((t) => (
                  <li key={t.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/app/tickets/${t.id}`} className="font-mono text-[13px] font-semibold hover:text-brand-700">{t.ticket_code}</Link><span className="font-mono text-[11px] text-ink-400">{t.complaint_code}</span>
                        <StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /><Badge>{t.category_label}</Badge>
                        {t.overdue && <Badge tone="red"><AlertTriangle className="size-3" />Over SLA ({age(t.age_hours)} / {age(t.sla_hours)})</Badge>}
                        {t.reopen_count > 0 && <Badge tone="red">Reopened ×{t.reopen_count}</Badge>}
                      </div>
                      <div className="mt-1 line-clamp-1 text-[13px] text-ink-700">{t.summary}</div>
                      <div className="mt-0.5 text-xs text-ink-500">{t.station?.name}{t.reported_asset ? ` · reported: ${t.reported_asset}` : ''} · open {age(t.age_hours)} · updated {fmtDate(t.updated_at)}</div>
                      {t.last_submission?.status === 'REJECTED' && <div className={cx('mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-800')}>{t.last_submission.review_type === 'MORE_EVIDENCE' ? 'More evidence requested' : 'Rework requested'} by {t.last_submission.reviewer?.full_name}: “{t.last_submission.review_reason}”</div>}
                    </div>
                    <div className="flex gap-2">
                      {['assigned', 'available'].includes(view) && ['RECEIVED', 'INVESTIGATING', 'ASSIGNED', 'REOPENED'].includes(t.status) &&
                        <Button size="sm" variant="primary" loading={busy === t.id} icon={<Play className="size-3.5" />} onClick={() => start(t)}>{view === 'available' ? 'Take & start' : 'Start work'}</Button>}
                      <Link to={`/app/tickets/${t.id}`}><Button size="sm">{t.status === 'IN_PROGRESS' ? 'Open & complete' : 'Open'}</Button></Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
