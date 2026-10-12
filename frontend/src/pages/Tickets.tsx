import { ArrowDownUp, Brain, Eye, Filter, MessageSquarePlus, MoreHorizontal, Paperclip, RotateCcw, Search, Ticket, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, PageHeader, Pagination, PriorityBadge, Select, StatusBadge, useToast } from '../components/ui'
import { api, qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { timeAgo, titleCase } from '../lib/format'
import { useApi, useDebounced } from '../lib/hooks'

export interface TicketRow {
  id: number; ticket_code: string; status: string; priority: string; assigned_team: string | null; assignee: { id: number; full_name: string } | null
  updated_at: string; created_at: string; reopen_count: number; complaint_id: number; complaint_code: string; category: string; category_label: string
  station: { id: number; name: string; code: string } | null; summary: string; language: string; attachments: number; priority_reason: string | null
}
interface Meta { states: string[]; teams: string[]; priorities: string[]; staff: { id: number; full_name: string; role: string; team: string | null }[]; categories: { value: string; en: string }[] }

export function AssignModal({ ticket, meta, open, onClose, onDone }: { ticket: { id: number; ticket_code: string; assigned_team: string | null } | null; meta: Meta | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [team, setTeam] = useState('')
  const [assignee, setAssignee] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  useEffect(() => { setTeam(ticket?.assigned_team ?? ''); setAssignee(''); setNote(''); setError(null) }, [ticket, open])
  const submit = async () => {
    if (!ticket) return
    setLoading(true); setError(null)
    try {
      await api(`/api/tickets/${ticket.id}/actions`, { method: 'POST', json: { action: 'assign', team: team || null, assignee_id: assignee ? Number(assignee) : null, note: note || null } })
      toast({ tone: 'success', message: `${ticket.ticket_code} assigned` }); onDone(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Assign ${ticket?.ticket_code ?? ''}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={loading} onClick={submit} icon={<UserPlus className="size-4" />}>Assign</Button></>}>
      <div className="space-y-4">
        <Field label="Team"><Select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">Category default</option>{meta?.teams.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Assignee (optional)"><Select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Unassigned individual</option>{meta?.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} — {titleCase(s.role)}{s.team ? ` · ${s.team}` : ''}</option>)}</Select></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional handover note" /></Field>
        {error && <div className="text-sm text-rose-600">{error}</div>}
      </div>
    </Modal>
  )
}

function RowMenu({ t, onAssign, canAssign, canInvestigate }: { t: TicketRow; onAssign: () => void; canAssign: boolean; canInvestigate: boolean }) {
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const toast = useToast()
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])
  const investigate = async () => {
    setBusy(true)
    try { const r = await api<{ id: number }>('/api/investigations', { method: 'POST', json: { ticket_id: t.id } }); nav(`/app/investigations/${r.id}`) }
    catch (e) { toast({ tone: 'error', message: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false); setOpen(false) }
  }
  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button aria-label="Row actions" onClick={() => setOpen(!open)} className="rounded-md p-1.5 text-ink-400 hover:bg-slate-100 hover:text-ink-900"><MoreHorizontal className="size-4" /></button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-lg border border-line bg-white py-1 text-sm shadow-pop">
          <button onClick={() => nav(`/app/tickets/${t.id}`)} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50"><Eye className="size-4 text-ink-400" />Open ticket</button>
          {canAssign && ['RECEIVED', 'INVESTIGATING', 'REOPENED'].includes(t.status) && <button onClick={() => { setOpen(false); onAssign() }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50"><UserPlus className="size-4 text-ink-400" />Assign…</button>}
          {canInvestigate && <button disabled={busy} onClick={investigate} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50"><Brain className="size-4 text-ink-400" />{busy ? 'Running agent…' : 'Run AI investigation'}</button>}
        </div>
      )}
    </div>
  )
}

export default function Tickets() {
  const { isStaff, can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const dq = useDebounced(q, 300)
  const status = sp.getAll('status')
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(true)
  const params = { q: dq, status, priority: sp.get('priority'), station_id: sp.get('station_id'), category: sp.get('category'), team: sp.get('team'),
    date_from: sp.get('date_from'), date_to: sp.get('date_to'), sort: sp.get('sort') ?? 'updated', order: sp.get('order') ?? 'desc', page, page_size: 15 }
  const { data, error, loading, reload } = useApi<{ total: number; items: TicketRow[]; status_counts: Record<string, number> }>(`/api/tickets${qs(params)}`, [])
  const { data: meta } = useApi<Meta>('/api/tickets/meta')
  const { data: stations } = useApi<{ items: { id: number; name: string }[] }>('/api/stations')
  const [assignFor, setAssignFor] = useState<TicketRow | null>(null)
  const nav = useNavigate()
  useEffect(() => { setPage(1) }, [dq, sp])
  useEffect(() => { const h = () => reload(true); window.addEventListener('megaasset:complaint-created', h); return () => window.removeEventListener('megaasset:complaint-created', h) }, [reload])

  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }) }
  const toggleStatus = (s: string) => { const n = new URLSearchParams(sp); const cur = n.getAll('status'); n.delete('status'); (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]).forEach((x) => n.append('status', x)); setSp(n, { replace: true }) }
  const sortBy = (k: string) => { const n = new URLSearchParams(sp); const same = (sp.get('sort') ?? 'updated') === k; n.set('sort', k); n.set('order', same && (sp.get('order') ?? 'desc') === 'desc' ? 'asc' : 'desc'); setSp(n, { replace: true }) }
  const activeFilters = ['priority', 'station_id', 'category', 'team', 'date_from', 'date_to'].filter((k) => sp.get(k)).length + status.length

  const SortTh = ({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) => (
    <th className={cx('px-4 py-2.5 text-left font-medium', className)}>
      <button onClick={() => sortBy(k)} className="inline-flex items-center gap-1 hover:text-ink-900">{children}<ArrowDownUp className={cx('size-3', (sp.get('sort') ?? 'updated') === k ? 'text-brand-600' : 'text-ink-400')} /></button>
    </th>
  )

  return (
    <div>
      <PageHeader eyebrow={isStaff ? 'Operations' : 'Passenger'} title={isStaff ? 'Ticket workspace' : 'My tickets'}
        description={isStaff ? 'Triage, assign and track every complaint ticket through its lifecycle. Priorities come from documented triage rules, not a predictive model.' : 'Every complaint you raise creates a ticket. Follow its progress here.'}
        actions={<Button variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={() => window.dispatchEvent(new Event('megaasset:raise-complaint'))}>Raise a Complaint</Button>} />

      <div className="mb-4 flex flex-wrap gap-2">
        {(meta?.states ?? []).map((s) => (
          <button key={s} onClick={() => toggleStatus(s)} className={cx('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition', status.includes(s) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line bg-white text-ink-500 hover:border-slate-300')}>
            {titleCase(s)}{data?.status_counts?.[s] !== undefined && !status.length ? <span className="text-ink-400">{data.status_counts[s]}</span> : null}
          </button>
        ))}
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ticket ID, complaint ID or description…" className="pl-9" />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowFilters(!showFilters)} icon={<Filter className="size-4" />} variant={showFilters ? 'subtle' : 'secondary'}>Filters{activeFilters ? ` (${activeFilters})` : ''}</Button>
            {activeFilters > 0 && <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setSp(new URLSearchParams(), { replace: true })}>Reset</Button>}
          </div>
        </div>
        {showFilters && (
          <div className="grid gap-3 border-b border-line bg-slate-50/50 p-4 sm:grid-cols-2 lg:grid-cols-6">
            <Select aria-label="Priority" value={sp.get('priority') ?? ''} onChange={(e) => setParam('priority', e.target.value)}><option value="">All priorities</option>{meta?.priorities.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</Select>
            <Select aria-label="Station" value={sp.get('station_id') ?? ''} onChange={(e) => setParam('station_id', e.target.value)}><option value="">All stations</option>{stations?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            <Select aria-label="Category" value={sp.get('category') ?? ''} onChange={(e) => setParam('category', e.target.value)}><option value="">All categories</option>{meta?.categories.map((c) => <option key={c.value} value={c.value}>{c.en}</option>)}</Select>
            <Select aria-label="Team" value={sp.get('team') ?? ''} onChange={(e) => setParam('team', e.target.value)}><option value="">All teams</option>{meta?.teams.map((t) => <option key={t}>{t}</option>)}</Select>
            <Input aria-label="From date" type="date" value={sp.get('date_from') ?? ''} onChange={(e) => setParam('date_from', e.target.value)} />
            <Input aria-label="To date" type="date" value={sp.get('date_to') ?? ''} onChange={(e) => setParam('date_to', e.target.value)} />
          </div>
        )}
        {error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : loading && !data ? <div className="p-4"><LoadingBlock rows={6} /></div> : !data?.items.length ? (
          <div className="p-6"><EmptyState icon={<Ticket className="size-6" />} title={activeFilters || dq ? 'No tickets match these filters' : 'No tickets yet'}
            description={activeFilters || dq ? 'Try removing a filter.' : 'Tickets are created automatically when a complaint is submitted.'} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-line bg-slate-50/60 text-xs text-ink-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Ticket</th>
                  <th className="px-4 py-2.5 text-left font-medium">Issue</th>
                  <th className="px-4 py-2.5 text-left font-medium">Station</th>
                  <SortTh k="status">Status</SortTh>
                  <SortTh k="priority">Priority</SortTh>
                  <th className="px-4 py-2.5 text-left font-medium">Assignment</th>
                  <SortTh k="updated">Updated</SortTh>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((t) => (
                  <tr key={t.id} onClick={() => nav(isStaff ? `/app/tickets/${t.id}` : `/app/complaints/${t.complaint_id}`)} className="cursor-pointer transition hover:bg-brand-50/30">
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-[13px] font-semibold text-ink-900">{t.ticket_code}</div>
                      <div className="font-mono text-[11px] text-ink-400">{t.complaint_code}</div>
                    </td>
                    <td className="max-w-xs px-4 py-3 align-top">
                      <div className="flex items-center gap-1.5"><Badge tone="gray">{t.category_label}</Badge>{t.language === 'ta' && <Badge tone="violet">தமிழ்</Badge>}{t.attachments > 0 && <span className="flex items-center gap-0.5 text-[11px] text-ink-400"><Paperclip className="size-3" />{t.attachments}</span>}{t.reopen_count > 0 && <Badge tone="red">Reopened ×{t.reopen_count}</Badge>}</div>
                      <div className="mt-1 line-clamp-2 text-[13px] text-ink-700">{t.summary}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-[13px]">{t.station ? <Link onClick={(e) => e.stopPropagation()} to={`/app/stations/${t.station.id}`} className="hover:text-brand-700">{t.station.name}</Link> : '—'}</td>
                    <td className="px-4 py-3 align-top"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-3 align-top"><span title={t.priority_reason ?? ''}><PriorityBadge priority={t.priority} /></span></td>
                    <td className="px-4 py-3 align-top text-[13px]"><div className="text-ink-700">{t.assigned_team ?? '—'}</div><div className="text-[11px] text-ink-400">{t.assignee?.full_name ?? 'No individual assignee'}</div></td>
                    <td className="px-4 py-3 align-top text-[13px] text-ink-500" title={t.updated_at}>{timeAgo(t.updated_at)}</td>
                    <td className="px-2 py-3 align-top">{isStaff && <RowMenu t={t} onAssign={() => setAssignFor(t)} canAssign={can('ticket:assign')} canInvestigate={can('investigation:run')} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && <div className="border-t border-line px-4 pb-3"><Pagination page={page} pageSize={15} total={data.total} onPage={setPage} /></div>}
      </Card>
      <AssignModal ticket={assignFor} meta={meta} open={!!assignFor} onClose={() => setAssignFor(null)} onDone={() => reload(true)} />
    </div>
  )
}
