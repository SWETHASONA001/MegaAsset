import { ExternalLink, FileText, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DocKindBadge } from '../../components/evidence'
import { Card, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, ProvenanceBadge, StatusBadge, Tabs } from '../../components/ui'
import { fileUrl } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { useApi } from '../../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Maintenance() {
  const { data, error, loading, reload } = useApi<any>('/api/operations/maintenance')
  const [tab, setTab] = useState<'work' | 'procurement'>('work')
  if (error) return <ErrorState message={error} onRetry={reload} />
  return (
    <div>
      <PageHeader eyebrow="Metro operations" title="Maintenance" description="Maintenance work recorded by engineers against tickets, kept separate from procurement documents that only describe intended scope." />
      <Notice tone="warn" title="Tenders are not completed maintenance">{data?.note ?? ''}</Notice>
      <div className="mt-5"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'work', label: 'Work records', count: data?.work_records.length }, { value: 'procurement', label: 'Procurement documents', count: data?.procurement_documents.length }]} /></div>
      <div className="mt-5">
        {loading || !data ? <LoadingBlock /> : tab === 'work' ? (!data.work_records.length ? (
          <EmptyState icon={<Wrench className="size-6" />} title="No maintenance work recorded yet" description="Engineers record inspections, repairs and other work from the ticket workspace. No maintenance history is present in the source data." />
        ) : (
          <Card padded={false}><ul className="divide-y divide-line">{data.work_records.map((m: any) => (
            <li key={m.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5 text-[13px]"><StatusBadge status={m.status} /><div className="min-w-0 flex-1"><div className="font-medium">{m.work_type} · {m.station?.name}</div><div className="text-ink-700">{m.description}</div>
              <div className="mt-1 text-xs text-ink-400">{m.performed_by?.full_name} · {fmtDate(m.created_at)}</div></div><ProvenanceBadge label={m.provenance} />{m.ticket_id && <Link className="text-xs font-medium text-brand-700" to={`/app/tickets/${m.ticket_id}`}>{m.ticket_code}</Link>}</li>))}</ul></Card>
        )) : (
          <Card padded={false}><ul className="divide-y divide-line">{data.procurement_documents.map((d: any) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]"><FileText className="size-4 text-ink-400" /><div className="min-w-0 flex-1"><div className="font-medium">{d.title}</div><div className="text-xs text-ink-500">{d.filename} · {d.page_count} pages</div></div>
              <DocKindBadge kind={d.doc_kind} /><StatusBadge status={d.status} /><Link className="text-xs font-medium text-brand-700" to={`/app/documents?doc=${d.id}`}>Details</Link>
              <a className="inline-flex items-center gap-1 text-xs font-medium text-brand-700" href={fileUrl(d.id)} target="_blank" rel="noreferrer">Open<ExternalLink className="size-3" /></a></li>))}</ul></Card>
        )}
      </div>
    </div>
  )
}
