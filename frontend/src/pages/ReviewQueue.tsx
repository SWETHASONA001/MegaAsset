import { AlarmClock, ClipboardCheck, Hourglass, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, PriorityBadge, Stat, StatusBadge, Tabs } from '../components/ui'
import { fmtDate } from '../lib/format'
import { useApi } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
type View = 'pending_review' | 'reopened' | 'overdue' | 'awaiting_verification'
const age = (h: number) => (h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`)

export default function ReviewQueue() {
  const { data, error, loading, reload } = useApi<any>('/api/review/queue')
  const [view, setView] = useState<View>('pending_review')
  useEffect(() => { const h = () => reload(true); window.addEventListener('megaasset:ticket-updated', h); return () => window.removeEventListener('megaasset:ticket-updated', h) }, [reload])
  if (error) return <ErrorState message={error} onRetry={reload} />
  const rows: any[] = data?.[view] ?? []
  return (
    <div>
      <PageHeader eyebrow="Supervisor workspace" title="Review queue" description="Engineer work awaiting your approval, plus reopened, overdue and pending-confirmation tickets. Approve or reject from the ticket page, where the complaint, evidence, findings and full audit timeline are shown." />
      {data && <Notice>Policy: supervisor review {data.policy.require_supervisor_review ? 'required' : 'disabled'} · self-approval {data.policy.allow_self_approval ? 'allowed' : 'not allowed'} · passenger confirmation {data.policy.auto_close_on_passenger_confirmation ? 'closes the ticket automatically' : 'resolves the ticket; staff close it'}. {data.policy.no_response_policy}</Notice>}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Awaiting your review" value={data?.pending_review.length ?? '—'} icon={<ClipboardCheck className="size-4" />} tone={data?.pending_review.length ? 'warn' : 'default'} />
        <Stat label="Reopened (active)" value={data?.reopened.length ?? '—'} icon={<RotateCcw className="size-4" />} />
        <Stat label="Over SLA" value={data?.overdue.length ?? '—'} icon={<AlarmClock className="size-4" />} hint={data ? `SLA: ${Object.entries(data.policy.sla_hours).map(([k, v]) => `${k[0]}${k.slice(1).toLowerCase()} ${v}h`).join(' · ')}` : ''} />
        <Stat label="Awaiting passenger" value={data?.awaiting_verification.length ?? '—'} icon={<Hourglass className="size-4" />} />
      </div>
      <Card padded={false} className="mt-6">
        <div className="px-4 pt-2"><Tabs value={view} onChange={setView} tabs={[
          { value: 'pending_review', label: 'Work to review', count: data?.pending_review.length }, { value: 'reopened', label: 'Reopened', count: data?.reopened.length },
          { value: 'overdue', label: 'Overdue', count: data?.overdue.length }, { value: 'awaiting_verification', label: 'Awaiting passenger', count: data?.awaiting_verification.length }]} /></div>
        {loading ? <div className="p-4"><LoadingBlock /></div> : rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={<ClipboardCheck className="size-6" />} title="Nothing in this queue" description="Queues are computed from current ticket records." /></div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/app/tickets/${t.id}`} className="font-mono text-[13px] font-semibold hover:text-brand-700">{t.ticket_code}</Link><span className="font-mono text-[11px] text-ink-400">{t.complaint_code}</span>
                  <StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /><Badge>{t.category_label}</Badge>
                  {t.overdue && <Badge tone="red">Over SLA · open {age(t.age_hours)}</Badge>}
                  {t.waiting_days !== undefined && <Badge tone={t.reminder_due ? 'amber' : 'gray'}>Waiting {t.waiting_days}d{t.reminder_due ? ' — follow up' : ''}</Badge>}
                  <span className="ml-auto text-xs text-ink-500">{t.station?.name} · {t.assignee?.full_name ?? 'unassigned'}</span>
                </div>
                <div className="mt-1 text-[13px] text-ink-700">{t.summary}</div>
                {t.submission && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-[13px]">
                    <div><b>Solution:</b> {t.submission.solution}</div>
                    <div className="mt-0.5"><b>Action taken:</b> {t.submission.action_taken}</div>
                    <div className="mt-1 text-xs text-ink-500">by {t.submission.engineer?.full_name} · {fmtDate(t.submission.created_at)}</div>
                    {t.submission.own_work && <div className="mt-1 text-xs text-amber-800">You submitted this work — another supervisor must review it.</div>}
                  </div>
                )}
                <div className="mt-2"><Link to={`/app/tickets/${t.id}`}><Button size="sm" variant={view === 'pending_review' ? 'primary' : 'secondary'}>{view === 'pending_review' ? 'Review evidence & decide' : 'Open ticket'}</Button></Link></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
