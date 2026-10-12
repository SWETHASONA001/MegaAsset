import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, CircleDashed, ExternalLink, XCircle } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { DocKindBadge } from '../components/evidence'
import { Badge, Card, CardHeader, cx, ErrorState, LoadingBlock, Notice, PageHeader, PriorityBadge, ProvenanceBadge, SectionTitle, StatusBadge } from '../components/ui'
import { fileUrl } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDate, titleCase } from '../lib/format'
import { useApi } from '../lib/hooks'
import { SolutionCard } from './TicketDetail'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function InvestigationDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const { data: i, error, loading, reload } = useApi<any>(`/api/investigations/${id}`)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !i) return <LoadingBlock rows={8} />
  const st = i.state ?? {}
  const traceBy = Object.fromEntries((i.trace ?? []).map((t: any) => [t.stage, t]))
  const stages: string[] = [...i.stages]
  if (traceBy.insufficient_evidence) stages.splice(stages.indexOf('recommend_solutions'), 1, 'insufficient_evidence')
  return (
    <div>
      <Link to="/app/investigations" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"><ArrowLeft className="size-3.5" />Investigations</Link>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{i.code}</span><StatusBadge status={i.status} /><ProvenanceBadge label="AI_HYPOTHESIS" /></span>}
        description={<>{i.ticket_code ? <>Ticket <Link className="text-brand-700 hover:underline" to={`/app/tickets/${i.ticket_id}`}>{i.ticket_code}</Link> · </> : 'Free-form · '}{fmtDate(i.created_at)} · {i.created_by?.full_name}</>} />
      <Notice tone="warn" title="Hypothesis, not a finding">{i.summary} Root causes are confirmed only by engineer findings; proposals require supervisor approval.</Notice>
      <div className="mt-6 grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader title="Workflow trace" subtitle="LangGraph stages with outputs" />
          <ol className="space-y-1">
            {stages.map((s, idx) => { const t = traceBy[s]; const ok = t?.status === 'ok'; return (
              <li key={s} className="rounded-lg border border-line p-2.5">
                <div className="flex items-center gap-2 text-[13px]">{!t ? <CircleDashed className="size-4 text-ink-400" /> : ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-rose-600" />}
                  <span className="font-medium">{idx + 1}. {titleCase(s)}</span>{t && <span className="ml-auto text-[11px] text-ink-400">{t.duration_ms} ms</span>}</div>
                {t?.summary && <div className={cx('mt-1 pl-6 text-[12px]', ok ? 'text-ink-500' : 'text-rose-700')}>{t.summary}</div>}
              </li>) })}
          </ol>
          <div className="mt-3 text-[11px] text-ink-400">Classification and risk use transparent rules (not trained models). No accuracy is claimed.</div>
        </Card>
        <div className="min-w-0 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card><div className="text-xs text-ink-500">Classification</div><div className="mt-1 font-semibold">{titleCase(st.classification?.predicted)}</div>
              <div className="mt-1 text-xs text-ink-500">{st.classification?.confidence} confidence · selected: {st.classification?.selected ?? '—'}</div>
              {st.classification && !st.classification.agrees_with_selection && <Badge tone="amber" className="mt-2">Mismatch — review</Badge>}</Card>
            <Card><div className="text-xs text-ink-500">Potential priority</div><div className="mt-1 flex items-center gap-2"><PriorityBadge priority={st.risk?.level ?? 'REQUIRES_REVIEW'} /><span className="text-xs text-ink-500">score {st.risk?.score}</span></div><div className="mt-2"><ProvenanceBadge label="POTENTIAL" /></div></Card>
            <Card><div className="text-xs text-ink-500">Evidence</div><div className="mt-1 font-semibold">{titleCase(st.sufficiency?.level)}</div>
              <div className="mt-1 flex flex-wrap gap-1">{Object.entries(st.sufficiency?.checks ?? {}).map(([k, v]) => <Badge key={k} tone={v ? 'green' : 'gray'}>{titleCase(k)}</Badge>)}</div></Card>
          </div>
          {st.sufficiency?.message && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{st.sufficiency.message}</div>}
          <Card>
            <CardHeader title="Proposed solutions" subtitle="Compared options awaiting human approval" />
            <div className="space-y-3">{i.solutions.map((s: any) => <SolutionCard key={s.id} s={s} canApprove={user?.role === 'admin'} onReviewed={() => reload(true)} />)}</div>
          </Card>
          <Card>
            <CardHeader title="Evidence gathered" />
            <SectionTitle>Document passages</SectionTitle>
            {!st.documents?.length ? <div className="text-[13px] text-ink-500">No document passages retrieved.</div> : <ul className="space-y-2">{st.documents.map((d: any, k: number) => (
              <li key={k} className="rounded-lg border border-line p-3 text-[13px]"><div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{d.filename}</span><span className="text-ink-500">p.{d.page}</span><DocKindBadge kind={d.doc_kind} /><Badge tone={d.relevance === 'STRONG' ? 'green' : d.relevance === 'MODERATE' ? 'blue' : 'gray'}>{titleCase(d.relevance)}</Badge>
                <a className="ml-auto inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" href={fileUrl(d.document_id, d.page)} target="_blank" rel="noreferrer">Open<ExternalLink className="size-3" /></a></div>
                <blockquote className="mt-1 border-l-2 border-brand-200 pl-2.5 text-[12.5px] text-ink-700">“{d.excerpt}”</blockquote></li>))}</ul>}
            <div className="mt-5"><SectionTitle>Linked entities</SectionTitle><div className="flex flex-wrap gap-1.5">{(st.entities ?? []).map((e: any) => <Badge key={e.key} tone="gray">{titleCase(e.type)}: {e.label}</Badge>)}{!st.entities?.length && <span className="text-[13px] text-ink-500">None</span>}</div>
              {st.graph_summary && <div className="mt-1 text-xs text-ink-500">Graph neighbourhood: {st.graph_summary.nodes} nodes, {st.graph_summary.edges} relationships</div>}</div>
            <div className="mt-5"><SectionTitle>Operations context</SectionTitle>
              <ul className="space-y-1 text-[13px] text-ink-700">
                {st.operations?.same_category_30d !== undefined && <li><ChevronRight className="inline size-3.5 text-ink-400" />{st.operations.same_category_30d} same-category complaints at station (30 days), {st.operations.same_category_90d} in 90 days</li>}
                {st.operations?.ridership && <li><ChevronRight className="inline size-3.5 text-ink-400" />{st.operations.ridership.passengers.toLocaleString('en-IN')} passengers on {st.operations.ridership.date} <span className="text-xs text-ink-400">({st.operations.ridership.source})</span></li>}
                <li><ChevronRight className="inline size-3.5 text-ink-400" />{st.operations?.verified_resolutions?.length ?? 0} verified resolutions and {st.operations?.counterexamples?.length ?? 0} counterexamples in this category</li>
                {st.operations?.telemetry && <li className="text-ink-500"><AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />{st.operations.telemetry}</li>}
                {st.operations?.notes?.map((n: string) => <li key={n} className="text-ink-500"><AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />{n}</li>)}
              </ul></div>
            {st.risk?.factors?.length > 0 && <div className="mt-5"><SectionTitle>Risk factors</SectionTitle><ul className="space-y-1">{st.risk.factors.map((f: any, k: number) => <li key={k} className="flex flex-wrap items-center gap-2 text-[13px]"><ProvenanceBadge label={f.provenance} /><b>{f.factor}</b><span className="text-ink-500">{f.detail}</span></li>)}</ul>
              <div className="mt-2 text-xs text-ink-500">{st.risk.rationale}</div></div>}
            {st.errors?.length > 0 && <div className="mt-5 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{st.errors.map((e: any) => <div key={e.stage}><b>{e.stage}</b>: {e.error}</div>)}</div>}
          </Card>
        </div>
      </div>
    </div>
  )
}
