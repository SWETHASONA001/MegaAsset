import { AlertTriangle, Brain, ExternalLink, FileText, ShieldAlert, Ticket } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DocKindBadge } from '../../components/evidence'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, PriorityBadge, ProvenanceBadge, Select, Tabs, useToast } from '../../components/ui'
import { api, fileUrl } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { useApi } from '../../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Risk() {
  const [days, setDays] = useState(90)
  const { data, error, loading, reload } = useApi<any>(`/api/risk/signals?days=${days}`)
  const [tab, setTab] = useState<'signals' | 'documented' | 'assessments'>('signals')
  const [busy, setBusy] = useState<number | null>(null)
  const toast = useToast()
  const nav = useNavigate()
  const investigate = async (ticketId: number) => {
    setBusy(ticketId)
    try { const r = await api<{ id: number }>('/api/investigations', { method: 'POST', json: { ticket_id: ticketId } }); nav(`/app/investigations/${r.id}`) }
    catch (e) { toast({ tone: 'error', message: (e as Error).message }) } finally { setBusy(null) }
  }
  if (error) return <ErrorState message={error} onRetry={reload} />
  return (
    <div>
      <PageHeader eyebrow="Metro operations" title="Risk intelligence" description="Potential emerging issues detected from real complaint records, investigation assessments and documented risk statements. Every signal explains why it deserves attention and what evidence is missing."
        actions={<Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-44"><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option></Select>} />
      <Notice tone="warn" title="Indications, not predictions">{data?.method ?? 'Transparent rules over real records.'} Repeated complaints raise investigative priority; they do not by themselves prove an asset failure.</Notice>
      <div className="mt-5"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'signals', label: 'Complaint signals', count: data?.signals.length }, { value: 'documented', label: 'Documented risk themes', count: data?.documented_themes.length }, { value: 'assessments', label: 'Investigation assessments', count: data?.assessments.length }]} /></div>
      <div className="mt-5">
        {loading || !data ? <LoadingBlock rows={5} /> : tab === 'signals' ? (!data.signals.length ? (
          <EmptyState icon={<ShieldAlert className="size-6" />} title="No complaint signals in this window" description="Signals appear when complaints cluster at a station and category, when safety concerns are reported, or when tickets are reopened. No synthetic data is used." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">{data.signals.map((s: any, i: number) => (
            <Card key={i}>
              <div className="flex items-start justify-between gap-3">
                <div><div className="flex flex-wrap items-center gap-2"><PriorityBadge priority={s.level} /><ProvenanceBadge label={s.provenance} /><span className="text-xs text-ink-500">score {s.score}</span></div>
                  <div className="mt-2 text-base font-semibold">{s.category_label} · <Link className="hover:text-brand-700" to={`/app/stations/${s.station.id}`}>{s.station.name}</Link></div></div>
                <div className="text-right text-xs text-ink-500"><div className="text-2xl font-semibold text-ink-900 tabular-nums">{s.complaints}</div>complaints</div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-slate-50 py-2"><b className="text-sm">{s.recent_30d}</b><div className="text-ink-500">last 30d</div></div><div className="rounded-lg bg-slate-50 py-2"><b className="text-sm">{s.open_tickets}</b><div className="text-ink-500">open</div></div><div className="rounded-lg bg-slate-50 py-2"><b className="text-sm">{s.reopens}</b><div className="text-ink-500">reopens</div></div></div>
              <div className="mt-3 text-[13px]"><div className="font-semibold text-ink-700">Why investigate</div><ul className="mt-1 list-disc pl-4 text-ink-700">{s.why.map((w: string) => <li key={w}>{w}</li>)}</ul></div>
              <div className="mt-2 text-[13px]"><div className="font-semibold text-ink-700">Information gaps</div><ul className="mt-1 list-disc pl-4 text-ink-500">{s.gaps.map((w: string) => <li key={w}>{w}</li>)}</ul></div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                <Button size="sm" variant="primary" loading={busy === s.ticket_ids[0]} icon={<Brain className="size-3.5" />} onClick={() => investigate(s.ticket_ids[0])}>Investigate latest ticket</Button>
                <Link to={`/app/tickets?station_id=${s.station.id}&category=${s.category}`}><Button size="sm" icon={<Ticket className="size-3.5" />}>View {s.ticket_ids.length} ticket(s)</Button></Link>
              </div>
            </Card>))}</div>
        )) : tab === 'documented' ? (!data.documented_themes.length ? <EmptyState icon={<FileText className="size-6" />} title="No documented risk statements found" /> : (
          <div className="grid gap-4 lg:grid-cols-2">{data.documented_themes.map((t: any) => (
            <Card key={t.topic}><CardHeader title={t.label} icon={<AlertTriangle className="size-4" />} action={<ProvenanceBadge label="DOCUMENTED" />} />
              <ul className="space-y-2.5">{t.evidence.map((e: any, i: number) => (
                <li key={i} className="text-[13px]"><div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500"><span className="font-medium text-ink-700">{e.filename}</span>p.{e.page}<DocKindBadge kind={e.doc_kind} />
                  <a className="ml-auto inline-flex items-center gap-1 text-brand-700 hover:underline" href={fileUrl(e.document_id, e.page)} target="_blank" rel="noreferrer">Open<ExternalLink className="size-3" /></a></div>
                  <blockquote className="mt-1 border-l-2 border-amber-200 pl-2.5 text-ink-700">“{e.excerpt}”</blockquote></li>))}</ul>
              <div className="mt-3 text-[11px] text-ink-400">Quoted as documented. Whether the risk is current, mitigated or materialised is not established by these passages.</div>
            </Card>))}</div>
        )) : (!data.assessments.length ? <EmptyState icon={<Brain className="size-6" />} title="No investigation assessments yet" description="Run an agentic investigation from a ticket to produce a risk assessment with explicit factors and gaps." /> : (
          <Card padded={false}><ul className="divide-y divide-line">{data.assessments.map((a: any) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]"><PriorityBadge priority={a.level} /><span className="font-medium">{a.category ?? '—'}</span><span className="text-ink-500">{a.station?.name}</span>
              <span className="text-xs text-ink-500">{a.factors.length} factors · {a.gaps.length} gaps</span>
              <span className="ml-auto flex items-center gap-3"><span className="text-xs text-ink-400">{fmtDate(a.created_at)}</span>{a.investigation_id && <Link className="text-xs font-medium text-brand-700" to={`/app/investigations/${a.investigation_id}`}>Trace</Link>}</span></li>))}</ul></Card>
        ))}
      </div>
      {!loading && data && <div className="mt-4"><Badge tone="gray">Window: {data.window_days} days</Badge></div>}
    </div>
  )
}
