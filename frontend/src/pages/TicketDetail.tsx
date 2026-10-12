import { Send, AlertTriangle, ArrowLeft, Brain, Check, CheckCircle2, ClipboardCheck, ExternalLink, FileText, Hammer, Lightbulb, Lock, MapPin, Network, Play, Plus, RotateCcw, Search as SearchIcon, ShieldAlert, UserPlus, Wrench, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DocKindBadge, Timeline } from '../components/evidence'
import { Badge, Button, Card, CardHeader, ConfirmDialog, cx, EmptyState, ErrorState, Field, Input, KeyValue, LoadingBlock, Modal, Notice, PageHeader, PriorityBadge, ProvenanceBadge, SectionTitle, Select, StatusBadge, Tabs, Textarea, useToast } from '../components/ui'
import { api, fileUrl } from '../lib/api'
import { fmtDate, titleCase } from '../lib/format'
import { useApi } from '../lib/hooks'
import { AttachmentGallery } from './ComplaintDetail'
import { AssignModal } from './Tickets'
import { AdminCloseModal, ReviewPanel, SimilarComplaints, SubmitWorkModal, VersionNote, WorkHistory } from '../components/WorkPanels'
import { emitTicketUpdated } from '../components/StationSidebar'
import { ApiError } from '../lib/api'

const FLOW = ['RECEIVED', 'INVESTIGATING', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_REVIEW', 'AWAITING_VERIFICATION', 'RESOLVED', 'CLOSED']

export interface Solution {
  id: number; title: string; problem: string; rationale: string; evidence: { type: string; provenance: string; excerpt: string; filename?: string; page?: number; document_id?: number; source?: string; doc_kind?: string }[]
  benefits: string[]; risks: string[]; dependencies: string[]; missing_info: string[]; approval_requirements: string[]; verification_criteria: string[]
  status: string; provenance: string; created_at: string; approvals: { decision: string; comment: string | null; reviewer: { full_name: string } | null; created_at: string }[]
}

function Lifecycle({ status }: { status: string }) {
  const idx = FLOW.indexOf(status)
  return (
    <div>
      {status === 'REOPENED' && <div className="mb-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"><RotateCcw className="size-3.5" />Reopened — issue reported as unresolved</div>}
      <ol className="space-y-2">
        {FLOW.map((s, i) => {
          const done = idx > i || (status === 'CLOSED' && i <= idx)
          const cur = s === status
          return (
            <li key={s} className="flex items-center gap-2.5 text-[13px]">
              <span className={cx('flex size-5 items-center justify-center rounded-full border text-[10px]', cur ? 'border-brand-600 bg-brand-600 text-white' : done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line bg-white text-ink-400')}>
                {done && !cur ? <Check className="size-3" /> : i + 1}
              </span>
              <span className={cx(cur ? 'font-semibold text-ink-900' : done ? 'text-ink-700' : 'text-ink-400')}>{titleCase(s)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function SolutionCard({ s, canApprove, onReviewed }: { s: Solution; canApprove: boolean; onReviewed: () => void }) {
  const [open, setOpen] = useState(false)
  const [review, setReview] = useState<'APPROVED' | 'REJECTED' | null>(null)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const doReview = async () => {
    if (!review) return
    setLoading(true)
    try { await api(`/api/tickets/solutions/${s.id}/review`, { method: 'POST', json: { decision: review, comment: comment || null } }); toast({ tone: 'success', message: `Solution ${review.toLowerCase()}` }); setReview(null); onReviewed() }
    catch (e) { toast({ tone: 'error', message: e instanceof Error ? e.message : String(e) }) } finally { setLoading(false) }
  }
  const List = ({ title, items, icon }: { title: string; items: string[]; icon?: ReactNode }) => items.length ? (
    <div><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-500">{icon}{title}</div><ul className="list-disc space-y-0.5 pl-4 text-[13px] text-ink-700">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
  ) : null
  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 rounded-lg bg-violet-50 p-1.5 text-violet-600"><Lightbulb className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={s.status} /><ProvenanceBadge label={s.provenance} /></div>
          <div className="mt-1.5 text-sm font-semibold text-ink-900">{s.title}</div>
          <div className="mt-1 text-[13px] text-ink-500"><span className="font-medium text-ink-700">Problem addressed:</span> {s.problem}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Details'}</Button>
      </div>
      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <div className="text-[13px] text-ink-700"><span className="font-semibold">Rationale: </span>{s.rationale}</div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-ink-500">Supporting evidence</div>
            <ul className="space-y-1.5">
              {s.evidence.map((e, i) => (
                <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px]">
                  <div className="flex flex-wrap items-center gap-1.5"><ProvenanceBadge label={e.provenance} /><span className="font-medium text-ink-700">{titleCase(e.type)}</span>{e.filename && <span className="text-ink-500">· {e.filename}{e.page ? ` p.${e.page}` : ''}</span>}{e.doc_kind && <DocKindBadge kind={e.doc_kind} />}
                    {e.document_id && <a className="ml-auto inline-flex items-center gap-1 text-brand-700 hover:underline" href={fileUrl(e.document_id, e.page)} target="_blank" rel="noreferrer">Open<ExternalLink className="size-3" /></a>}</div>
                  <div className="mt-1 text-ink-700">{e.excerpt}</div>
                  {e.source && <div className="mt-0.5 text-[11px] text-ink-400">{e.source}</div>}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <List title="Potential benefits" items={s.benefits} />
            <List title="Risks & limitations" items={s.risks} />
            <List title="Dependencies" items={s.dependencies} />
            <List title="Missing information" items={s.missing_info} icon={<AlertTriangle className="size-3 text-amber-500" />} />
            <List title="Approval requirements" items={s.approval_requirements} icon={<Lock className="size-3" />} />
            <List title="Verification criteria" items={s.verification_criteria} icon={<ClipboardCheck className="size-3" />} />
          </div>
          <div className="text-[11px] text-ink-400">Costs, timelines and feasibility are not estimated — they are not established by the evidence.</div>
          {s.approvals.map((a, i) => <div key={i} className="text-xs text-ink-500">{a.decision} by {a.reviewer?.full_name} · {fmtDate(a.created_at)}{a.comment ? ` — “${a.comment}”` : ''}</div>)}
        </div>
      )}
      {canApprove && s.status === 'PROPOSED' && (
        <div className="flex items-center justify-between gap-2 border-t border-line bg-slate-50/60 px-4 py-2.5">
          <span className="text-xs text-ink-500">Human approval gate — supervisor decision required</span>
          <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setReview('REJECTED')} icon={<X className="size-3.5" />}>Reject</Button><Button size="sm" variant="primary" onClick={() => setReview('APPROVED')} icon={<Check className="size-3.5" />}>Approve</Button></div>
        </div>
      )}
      <ConfirmDialog open={!!review} onClose={() => setReview(null)} title={review === 'APPROVED' ? 'Approve this solution?' : 'Reject this solution?'} loading={loading} onConfirm={doReview}
        tone={review === 'REJECTED' ? 'danger' : 'primary'} confirmLabel={review === 'APPROVED' ? 'Approve' : 'Reject'}
        message={review === 'APPROVED' ? 'Approval authorises the responsible team to act. It does not perform any physical action, and the ticket still requires passenger verification before it can be resolved.' : 'The proposal will be marked rejected and kept in the record.'}>
        <Field label="Reviewer comment"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function TicketDetail() {
  const { id } = useParams()
  const { data: t, error, loading, reload } = useApi<any>(`/api/tickets/${id}`)
  const { data: meta } = useApi<any>('/api/tickets/meta')
  const [tab, setTab] = useState<'analysis' | 'solutions' | 'findings' | 'evidence' | 'related'>('analysis')
  const [confirm, setConfirm] = useState<null | { action: string; title: string; message: string; tone?: 'primary' | 'danger' }>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [findingOpen, setFindingOpen] = useState(false)
  const [solutionOpen, setSolutionOpen] = useState(false)
  const [maintOpen, setMaintOpen] = useState(false)
  const [workOpen, setWorkOpen] = useState(false)
  const [adminCloseOpen, setAdminCloseOpen] = useState(false)
  const toast = useToast()
  const nav = useNavigate()

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !t) return <LoadingBlock rows={8} />
  const p = t.permissions
  const allowed: string[] = t.allowed_transitions
  const c = t.complaint

  const fail = (e: unknown) => {
    toast({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    if (e instanceof ApiError && e.status === 409) { setConfirm(null); reload(true) }  // concurrent change: show fresh state
  }
  const act = async (action: string) => {
    setBusy(true)
    try { await api(`/api/tickets/${t.id}/actions`, { method: 'POST', json: { action, note: note || null, expected_version: t.version } }); toast({ tone: 'success', message: `${titleCase(action)} — done` }); setConfirm(null); setNote(''); emitTicketUpdated(); reload(true) }
    catch (e) { fail(e) } finally { setBusy(false) }
  }
  const verify = async (outcome: string) => {
    setBusy(true)
    try { await api(`/api/tickets/${t.id}/verify`, { method: 'POST', json: { outcome, comment: note || null, expected_version: t.version } }); toast({ tone: 'success', message: 'Verification recorded' }); setConfirm(null); setNote(''); emitTicketUpdated(); reload(true) }
    catch (e) { fail(e) } finally { setBusy(false) }
  }
  const investigate = async () => {
    setBusy(true)
    try { const r = await api<{ id: number }>('/api/investigations', { method: 'POST', json: { ticket_id: t.id } }); toast({ tone: 'success', message: 'Agentic investigation completed' }); nav(`/app/investigations/${r.id}`) }
    catch (e) { toast({ tone: 'error', message: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  const actions: ReactNode[] = []
  if (allowed.includes('INVESTIGATING') && p.start_investigation) actions.push(<Button key="inv" icon={<SearchIcon className="size-4" />} onClick={() => setConfirm({ action: 'start_investigation', title: 'Start investigation?', message: 'The ticket moves to INVESTIGATING and the passenger is notified.' })}>Start investigation</Button>)
  if (allowed.includes('ASSIGNED') && p.assign) actions.push(<Button key="as" icon={<UserPlus className="size-4" />} onClick={() => setAssignOpen(true)}>Assign</Button>)
  if (['RECEIVED', 'INVESTIGATING', 'ASSIGNED', 'REOPENED'].includes(t.status) && p.start_work) actions.push(<Button key="wk" icon={<Play className="size-4" />} onClick={() => setConfirm({ action: 'start_work', title: 'Start work?', message: t.assignee ? 'Marks the ticket IN_PROGRESS.' : 'You will be recorded as the assigned engineer, then the ticket moves to IN_PROGRESS.' })}>Start work</Button>)
  if (p.submit_work) actions.push(<Button key="cw" variant="primary" icon={<Send className="size-4" />} onClick={() => setWorkOpen(true)}>Complete work</Button>)
  if (p.admin_close) actions.push(<Button key="ac" variant="ghost" icon={<Lock className="size-4" />} onClick={() => setAdminCloseOpen(true)}>Admin close</Button>)
  if (allowed.includes('AWAITING_VERIFICATION') && p.request_verification && t.status === 'IN_PROGRESS') actions.push(<Button key="rv" icon={<ClipboardCheck className="size-4" />} onClick={() => setConfirm({ action: 'request_verification', title: 'Request passenger verification?', message: 'The passenger will be asked to confirm whether the issue is resolved. The ticket cannot be resolved without verification.' })}>Request verification</Button>)
  if (t.status === 'RESOLVED' && p.close) actions.push(<Button key="cl" icon={<Lock className="size-4" />} onClick={() => setConfirm({ action: 'close', title: 'Close ticket?', message: 'Closing is final unless the ticket is reopened. Only verified-resolved tickets can be closed.' })}>Close</Button>)
  if (['RESOLVED', 'CLOSED'].includes(t.status) && p.reopen) actions.push(<Button key="ro" variant="danger" icon={<RotateCcw className="size-4" />} onClick={() => setConfirm({ action: 'reopen', title: 'Reopen ticket?', message: 'Reopening records the previous action as a counterexample in resolution memory.', tone: 'danger' })}>Reopen</Button>)

  const analysis = t.analysis

  return (
    <div>
      <Link to="/app/tickets" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"><ArrowLeft className="size-3.5" />All tickets</Link>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{t.ticket_code}</span><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /></span>}
        description={<>Complaint <span className="font-mono">{t.complaint_code}</span> · {t.category_label} at <Link className="text-brand-700 hover:underline" to={`/app/stations/${t.station?.id}`}>{t.station?.name}</Link> · opened {fmtDate(t.created_at)}</>}
        actions={<>{p.investigate && <Button variant="subtle" loading={busy} icon={<Brain className="size-4" />} onClick={investigate}>Run AI investigation</Button>}{actions}</>} />

      {t.status === 'PENDING_REVIEW' && <div className="mb-4"><ReviewPanel ticket={t} onDone={() => reload(true)} /></div>}
      {t.status === 'IN_PROGRESS' && t.work_submissions?.[0]?.status === 'REJECTED' && (
        <div className="mb-4"><Notice tone="warn" title={t.work_submissions[0].review_type === 'MORE_EVIDENCE' ? 'Supervisor requested more evidence' : 'Supervisor requested rework'}>
          “{t.work_submissions[0].review_reason}” — {t.work_submissions[0].reviewer?.full_name}</Notice></div>
      )}
      {t.closure_type && t.status === 'CLOSED' && <div className="mb-4"><Notice title="Closed">{t.closure_type === 'ADMIN_CLOSED' ? 'Administratively closed (audited). This is not a verified resolution.' : t.closure_type === 'PASSENGER_VERIFIED' ? 'Closed after the passenger confirmed the issue was resolved.' : t.closure_type === 'STAFF_RECORDED_VERIFICATION' ? 'Closed after staff recorded the passenger’s confirmation.' : 'Closed by staff after resolution.'}</Notice></div>}
      {t.status === 'AWAITING_VERIFICATION' && p.verify && (
        <Notice title="Awaiting passenger verification">
          The passenger has been asked to confirm the outcome. As a supervisor you may record a staff verification on their behalf if they confirmed through another channel.
          <div className="mt-2 flex gap-2"><Button size="sm" variant="primary" onClick={() => setConfirm({ action: 'verify:RESOLVED', title: 'Record: issue resolved?', message: 'A staff verification record will be stored. Use only when the passenger has confirmed.' })}>Issue resolved</Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm({ action: 'verify:STILL_EXISTS', title: 'Record: issue still exists?', message: 'The ticket will be reopened.', tone: 'danger' })}>Issue still exists</Button></div>
        </Notice>
      )}

      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Complaint" subtitle={`Submitted ${fmtDate(c.created_at)}${c.user ? ` by ${c.user.full_name}` : ''}`} action={<div className="flex gap-1.5"><ProvenanceBadge label="REPORTED" />{c.language === 'ta' && <Badge tone="violet">Tamil</Badge>}</div>} />
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-900">{c.description}</p>
            {c.attachments.length > 0 && <div className="mt-4"><SectionTitle>Attachments & evidence</SectionTitle><AttachmentGallery items={c.attachments} /></div>}
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-ink-500">The passenger-selected category is a report. It is not treated as proof that an incident occurred.</div>
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-3">
              <Tabs value={tab} onChange={setTab} tabs={[
                { value: 'analysis', label: 'AI analysis' }, { value: 'solutions', label: 'Solutions', count: t.solutions?.length ?? 0 },
                { value: 'findings', label: 'Findings & work', count: (t.findings?.length ?? 0) + (t.maintenance?.length ?? 0) + (t.work_submissions?.length ?? 0) },
                { value: 'evidence', label: 'Evidence & graph' }, { value: 'related', label: 'Related & similar', count: (t.similar_complaints?.length ?? 0) }]} />
            </div>
            <div className="p-5">
              {tab === 'analysis' && (!analysis ? (
                <EmptyState icon={<Brain className="size-6" />} title="No AI analysis yet" description="Run the agentic investigation to classify the complaint, link entities, retrieve document and graph evidence, assess potential risk and propose solutions for human approval."
                  action={p.investigate && <Button variant="primary" loading={busy} onClick={investigate} icon={<Brain className="size-4" />}>Run AI investigation</Button>} />
              ) : (
                <div className="space-y-5">
                  <Notice tone="warn" title="AI hypothesis — requires human review">This analysis was produced by the agentic workflow ({analysis.code}). It is not a confirmed finding. <Link className="font-medium underline" to={`/app/investigations/${analysis.investigation_id}`}>View full trace</Link></Notice>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-line p-3"><div className="text-xs text-ink-500">Classification</div><div className="mt-1 font-semibold">{titleCase(analysis.classification?.predicted)}</div>
                      <div className="mt-1 text-xs text-ink-500">{analysis.classification?.confidence} confidence · {analysis.classification?.agrees_with_selection ? 'matches passenger selection' : 'differs from passenger selection'}</div></div>
                    <div className="rounded-lg border border-line p-3"><div className="text-xs text-ink-500">Potential investigative priority</div><div className="mt-1 flex items-center gap-2"><PriorityBadge priority={analysis.risk?.level ?? 'REQUIRES_REVIEW'} /><span className="text-xs text-ink-500">score {analysis.risk?.score}</span></div>
                      <div className="mt-1"><ProvenanceBadge label="POTENTIAL" /></div></div>
                    <div className="rounded-lg border border-line p-3"><div className="text-xs text-ink-500">Evidence sufficiency</div><div className="mt-1 font-semibold">{titleCase(analysis.sufficiency?.level)}</div>
                      <div className="mt-1 text-xs text-ink-500">{analysis.sufficiency?.root_cause}</div></div>
                  </div>
                  {analysis.risk?.factors?.length > 0 && <div><SectionTitle>Risk factors</SectionTitle><ul className="space-y-1.5">{analysis.risk.factors.map((f: any, i: number) => <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]"><ProvenanceBadge label={f.provenance} /><span className="font-medium">{f.factor}</span><span className="text-ink-500">— {f.detail}</span></li>)}</ul></div>}
                  {analysis.risk?.gaps?.length > 0 && <div><SectionTitle>Information gaps</SectionTitle><ul className="list-disc pl-5 text-[13px] text-ink-700">{analysis.risk.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul></div>}
                  <div className="text-xs text-ink-500">{analysis.risk?.rationale}</div>
                </div>
              ))}
              {tab === 'solutions' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><div className="text-[13px] text-ink-500">Proposals stay hypotheses until a supervisor approves them. No action is performed automatically.</div>{p.propose && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setSolutionOpen(true)}>Propose solution</Button>}</div>
                  {!t.solutions?.length ? <EmptyState icon={<Lightbulb className="size-6" />} title="No solutions proposed" description="Run the AI investigation or propose a solution manually." /> :
                    t.solutions.map((s: Solution) => <SolutionCard key={s.id} s={s} canApprove={p.approve} onReviewed={() => reload(true)} />)}
                </div>
              )}
              {tab === 'findings' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap gap-2">{p.finding && <Button size="sm" icon={<Hammer className="size-3.5" />} onClick={() => setFindingOpen(true)}>Add finding</Button>}{p.maintenance && <Button size="sm" icon={<Wrench className="size-3.5" />} onClick={() => setMaintOpen(true)}>Record maintenance work</Button>}</div>
                  <div><SectionTitle>Work submissions & supervisor review</SectionTitle><WorkHistory items={t.work_submissions ?? []} /></div>
                  <div><SectionTitle>Engineer findings</SectionTitle>{!t.findings?.length ? <div className="text-[13px] text-ink-500">No findings recorded. A root cause is only confirmed through an engineer finding.</div> :
                    <ul className="space-y-2">{t.findings.map((f: any) => <li key={f.id} className="rounded-lg border border-line p-3"><div className="flex flex-wrap items-center gap-1.5"><ProvenanceBadge label={f.provenance} />{f.confirmed_incident && <Badge tone="red">Incident confirmed</Badge>}{f.root_cause && <Badge tone={f.cause_verified ? 'green' : 'violet'}>{f.cause_verified ? 'Verified cause' : 'Cause hypothesis'}</Badge>}<span className="text-xs text-ink-500">{f.author?.full_name} · {fmtDate(f.created_at)}</span></div>
                      <div className="mt-1.5 text-[13px] text-ink-900">{f.finding}</div>{f.root_cause && <div className="mt-1 text-[13px] text-ink-700"><b>{f.cause_verified ? 'Verified root cause' : 'Root-cause hypothesis'}:</b> {f.root_cause}</div>}</li>)}</ul>}</div>
                  <div><SectionTitle>Maintenance work records</SectionTitle>{!t.maintenance?.length ? <div className="text-[13px] text-ink-500">No work recorded on this ticket.</div> :
                    <ul className="space-y-2">{t.maintenance.map((m: any) => <li key={m.id} className="rounded-lg border border-line p-3 text-[13px]"><div className="flex items-center gap-2"><StatusBadge status={m.status} /><span className="font-medium">{m.work_type}</span><span className="text-xs text-ink-500">{fmtDate(m.created_at)}</span></div><div className="mt-1 text-ink-700">{m.description}</div></li>)}</ul>}</div>
                  {t.incidents?.length > 0 && <div><SectionTitle>Incidents</SectionTitle>{t.incidents.map((i: any) => <div key={i.id} className="flex items-center gap-2 text-[13px]"><ShieldAlert className="size-4 text-rose-500" /><span className="font-mono">{i.code}</span>{i.title}<ProvenanceBadge label={i.provenance} /></div>)}</div>}
                </div>
              )}
              {tab === 'evidence' && (
                <div className="space-y-5">
                  <div><SectionTitle>Related documents & exact pages</SectionTitle>
                    {!analysis?.documents?.length ? <div className="text-[13px] text-ink-500">Run the AI investigation to retrieve related document passages.</div> : (
                      <ul className="space-y-2">{analysis.documents.map((d: any, i: number) => (
                        <li key={i} className="rounded-lg border border-line p-3">
                          <div className="flex flex-wrap items-center gap-1.5 text-[13px]"><FileText className="size-3.5 text-ink-400" /><span className="font-medium">{d.filename}</span><span className="text-ink-500">p.{d.page}</span><DocKindBadge kind={d.doc_kind} /><Badge tone={d.relevance === 'STRONG' ? 'green' : d.relevance === 'MODERATE' ? 'blue' : 'gray'}>{titleCase(d.relevance)} match</Badge>
                            <a href={fileUrl(d.document_id, d.page)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">Open page<ExternalLink className="size-3" /></a></div>
                          <blockquote className="mt-1.5 border-l-2 border-brand-200 pl-2.5 text-[12.5px] text-ink-700">“{d.excerpt}”</blockquote>
                        </li>))}</ul>)}
                  </div>
                  <div><SectionTitle>Related assets (documented at station)</SectionTitle>
                    {!analysis?.assets?.length ? <div className="text-[13px] text-ink-500">No candidate assets identified for this category/station.</div> :
                      <div className="flex flex-wrap gap-2">{analysis.assets.map((a: any) => <Link key={a.id} to={`/app/assets/${a.id}`} className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:border-brand-300">{a.name}</Link>)}</div>}
                    {analysis?.assets?.length > 0 && <div className="mt-1.5 text-[11px] text-ink-400">Candidates only — the specific unit involved is not identified from the complaint text.</div>}
                  </div>
                  <div><SectionTitle action={<Link to="/app/knowledge-graph" className="text-xs text-brand-700 hover:underline">Open graph</Link>}>Graph relationships</SectionTitle>
                    {!t.graph?.edges?.length ? <div className="text-[13px] text-ink-500">No graph relationships yet.</div> : (
                      <ul className="divide-y divide-line rounded-lg border border-line">{t.graph.edges.slice(0, 14).map((e: any) => {
                        const n = (id: number) => t.graph.nodes.find((x: any) => x.id === id)
                        return <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12.5px]"><Network className="size-3.5 text-ink-400" /><span className="font-medium">{n(e.source)?.label}</span><Badge tone="gray">{e.type}</Badge><span className="font-medium">{n(e.target)?.label}</span><span className="ml-auto"><ProvenanceBadge label={e.provenance} /></span></li>
                      })}</ul>)}
                  </div>
                </div>
              )}
              {tab === 'related' && (
                <div className="space-y-2">
                  <SectionTitle>Similar complaints (text similarity, not merged)</SectionTitle>
                  <SimilarComplaints items={t.similar_complaints ?? []} />
                  <div className="pt-3"><SectionTitle>Other complaints at this station</SectionTitle></div>
                  {!t.related_complaints?.length ? <EmptyState title="No other complaints at this station" /> : t.related_complaints.map((r: any) => (
                    <Link key={r.id} to={r.ticket_id ? `/app/tickets/${r.ticket_id}` : '#'} className="flex items-center gap-3 rounded-lg border border-line p-3 text-[13px] hover:border-brand-300">
                      <span className="font-mono text-xs">{r.complaint_code}</span>{r.same_category && <Badge tone="amber">Same category</Badge>}<span className="min-w-0 flex-1 truncate text-ink-700">{r.summary}</span>{r.status && <StatusBadge status={r.status} />}
                    </Link>))}
                  <div className="text-[11px] text-ink-400">Repeated complaints may raise investigative priority but do not by themselves prove an asset failure.</div>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <KeyValue cols={1} items={[
              ['Ticket / complaint', <span className="font-mono text-[13px]">{t.ticket_code} · {t.complaint_code}</span>],
              ['Station', <span className="flex items-center gap-1"><MapPin className="size-3.5 text-ink-400" />{t.station?.name}</span>],
              ['Category', t.category_label], ['Assigned team', t.assigned_team ?? '—'], ['Assignee', t.assignee?.full_name ?? '—'],
              ['Priority rationale', <span className="text-[13px] text-ink-700">{t.priority_reason}</span>],
              ['Reported equipment', c.reported_asset ? <span>{c.reported_asset.name} <Badge tone="blue">REPORTED</Badge></span> : 'Not specified'],
              ['Created', fmtDate(t.created_at)], ['Last updated', <span>{fmtDate(t.updated_at)} <VersionNote version={t.version} /></span>], ['Resolved', fmtDate(t.resolved_at)], ['Closed', fmtDate(t.closed_at)]]} />
          </Card>
          <Card><CardHeader title="Lifecycle" /><Lifecycle status={t.status} /></Card>
          <Card>
            <CardHeader title="Verification & resolution" />
            {!t.verifications.length ? <div className="text-[13px] text-ink-500">No verification recorded yet.</div> : t.verifications.map((v: any, i: number) => (
              <div key={i} className="mb-2 flex items-start gap-2 text-[13px]">{v.outcome === 'RESOLVED' ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" /> : <RotateCcw className="mt-0.5 size-4 text-rose-600" />}
                <div><div className="font-medium">{v.outcome === 'RESOLVED' ? 'Issue resolved' : 'Issue still exists'} <span className="font-normal text-ink-500">({titleCase(v.verifier_type)})</span></div><div className="text-xs text-ink-500">{fmtDate(v.created_at)}{v.comment ? ` — ${v.comment}` : ''}</div></div></div>))}
            {t.resolution_memory?.map((m: any) => <div key={m.id} className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"><Badge tone={m.outcome === 'VERIFIED_RESOLVED' ? 'green' : 'red'}>{titleCase(m.outcome)}</Badge> <span className="text-ink-500">stored in resolution memory</span></div>)}
          </Card>
          <Card><CardHeader title="Activity timeline" /><Timeline events={[...t.events].reverse()} /></Card>
        </div>
      </div>

      <AssignModal ticket={t} meta={meta} open={assignOpen} onClose={() => setAssignOpen(false)} onDone={() => { emitTicketUpdated(); reload(true) }} />
      <SubmitWorkModal open={workOpen} onClose={() => setWorkOpen(false)} ticket={t} onDone={() => reload(true)} />
      <AdminCloseModal open={adminCloseOpen} onClose={() => setAdminCloseOpen(false)} ticket={t} onDone={() => reload(true)} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title ?? ''} message={confirm?.message} tone={confirm?.tone} loading={busy}
        onConfirm={() => confirm && (confirm.action.startsWith('verify:') ? verify(confirm.action.split(':')[1]) : act(confirm.action))}>
        <Field label="Note (recorded in the activity timeline)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
      <FindingModal open={findingOpen} onClose={() => setFindingOpen(false)} ticketId={t.id} assets={t.station_assets ?? analysis?.assets ?? []} onDone={() => reload(true)} />
      <SolutionModal open={solutionOpen} onClose={() => setSolutionOpen(false)} ticketId={t.id} onDone={() => reload(true)} />
      <MaintenanceModal open={maintOpen} onClose={() => setMaintOpen(false)} ticketId={t.id} assets={t.station_assets ?? analysis?.assets ?? []} onDone={() => reload(true)} />
    </div>
  )
}

function useSubmit(onDone: () => void, onClose: () => void) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const run = async (path: string, json: unknown, msg: string) => {
    setLoading(true); setError(null)
    try { await api(path, { method: 'POST', json }); toast({ tone: 'success', message: msg }); onDone(); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  return { loading, error, run }
}

function FindingModal({ open, onClose, ticketId, assets, onDone }: { open: boolean; onClose: () => void; ticketId: number; assets: any[]; onDone: () => void }) {
  const [f, setF] = useState({ finding: '', root_cause: '', cause_verified: false, confirmed_incident: false, asset_id: '' })
  const { loading, error, run } = useSubmit(onDone, onClose)
  return (
    <Modal open={open} onClose={onClose} title="Add engineer finding" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={loading} disabled={f.finding.length < 5}
      onClick={() => run(`/api/tickets/${ticketId}/findings`, { ...f, root_cause: f.root_cause || null, asset_id: f.asset_id ? Number(f.asset_id) : null }, 'Finding recorded')}>Save finding</Button></>}>
      <div className="space-y-4">
        <Field label="Finding" required><Textarea rows={3} value={f.finding} onChange={(e) => setF({ ...f, finding: e.target.value })} placeholder="What was observed on site?" /></Field>
        <Field label="Root cause (if established)"><Textarea rows={2} value={f.root_cause} onChange={(e) => setF({ ...f, root_cause: e.target.value })} /></Field>
        {assets.length > 0 && <Field label="Asset"><Select value={f.asset_id} onChange={(e) => setF({ ...f, asset_id: e.target.value })}><option value="">Not specified</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
        {f.root_cause.trim() && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.cause_verified} onChange={(e) => setF({ ...f, cause_verified: e.target.checked })} /><span>Root cause verified on site <span className="block text-xs text-ink-500">Leave unchecked to record it as a hypothesis.</span></span></label>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.confirmed_incident} onChange={(e) => setF({ ...f, confirmed_incident: e.target.checked })} /><span>I confirm an incident occurred <span className="block text-xs text-ink-500">Creates a VERIFIED incident record. Leave unchecked if the issue could not be confirmed.</span></span></label>
        {error && <div className="text-sm text-rose-600">{error}</div>}
      </div>
    </Modal>
  )
}

function SolutionModal({ open, onClose, ticketId, onDone }: { open: boolean; onClose: () => void; ticketId: number; onDone: () => void }) {
  const [f, setF] = useState({ title: '', problem: '', rationale: '', benefits: '', risks: '', dependencies: '', missing_info: '', verification_criteria: '' })
  const { loading, error, run } = useSubmit(onDone, onClose)
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
  return (
    <Modal open={open} onClose={onClose} title="Propose a solution" width="max-w-2xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={loading} disabled={f.title.length < 5 || f.problem.length < 5 || f.rationale.length < 5}
      onClick={() => run(`/api/tickets/${ticketId}/solutions`, { title: f.title, problem: f.problem, rationale: f.rationale, benefits: lines(f.benefits), risks: lines(f.risks), dependencies: lines(f.dependencies), missing_info: lines(f.missing_info), verification_criteria: lines(f.verification_criteria) }, 'Solution proposed — awaiting approval')}>Submit for approval</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field></div>
        <Field label="Problem addressed" required><Textarea rows={2} value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} /></Field>
        <Field label="Rationale / evidence" required><Textarea rows={2} value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} /></Field>
        {(['benefits', 'risks', 'dependencies', 'missing_info', 'verification_criteria'] as const).map((k) => (
          <Field key={k} label={titleCase(k)} hint="One per line"><Textarea rows={2} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>))}
        {error && <div className="text-sm text-rose-600 sm:col-span-2">{error}</div>}
      </div>
    </Modal>
  )
}

function MaintenanceModal({ open, onClose, ticketId, assets, onDone }: { open: boolean; onClose: () => void; ticketId: number; assets: any[]; onDone: () => void }) {
  const [f, setF] = useState({ work_type: 'Inspection', description: '', status: 'COMPLETED', asset_id: '' })
  const { loading, error, run } = useSubmit(onDone, onClose)
  return (
    <Modal open={open} onClose={onClose} title="Record maintenance work" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={loading} disabled={f.description.length < 5}
      onClick={() => run(`/api/tickets/${ticketId}/maintenance`, { ...f, asset_id: f.asset_id ? Number(f.asset_id) : null }, 'Work recorded')}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3"><Field label="Work type"><Select value={f.work_type} onChange={(e) => setF({ ...f, work_type: e.target.value })}>{['Inspection', 'Repair', 'Cleaning', 'Replacement', 'Adjustment', 'Other'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['PLANNED', 'IN_PROGRESS', 'COMPLETED'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select></Field></div>
        {assets.length > 0 && <Field label="Asset"><Select value={f.asset_id} onChange={(e) => setF({ ...f, asset_id: e.target.value })}><option value="">Not specified</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
        <Field label="Description" required><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {error && <div className="text-sm text-rose-600">{error}</div>}
      </div>
    </Modal>
  )
}
