import { ArrowLeft, ExternalLink, FileText, Info } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { DocKindBadge } from '../components/evidence'
import { Badge, Card, CardHeader, EmptyState, ErrorState, KeyValue, LoadingBlock, Notice, PageHeader, ProvenanceBadge, StatusBadge } from '../components/ui'
import { fileUrl } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtDate, titleCase } from '../lib/format'
import { useApi } from '../lib/hooks'
import { ASSET_TONE } from './Assets'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AssetDetail() {
  const { id } = useParams()
  const { isStaff } = useAuth()
  const { data: a, error, loading, reload } = useApi<any>(`/api/assets/${id}`)
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !a) return <LoadingBlock rows={6} />
  return (
    <div>
      <Link to="/app/assets" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"><ArrowLeft className="size-3.5" />Asset registry</Link>
      <PageHeader title={a.name} meta={<><Badge tone={ASSET_TONE[a.asset_type]}>{titleCase(a.asset_type)}</Badge><Badge className="font-mono">{a.asset_code}</Badge><ProvenanceBadge label={a.provenance} /></>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card><CardHeader title="Documented record" />
            <KeyValue items={[['Station', a.station && <Link className="text-brand-700 hover:underline" to={`/app/stations/${a.station.id}`}>{a.station.name}</Link>], ['Entrance', a.attributes.entrance], ['GTFS description', a.attributes.gtfs_stop_desc],
              ['Access modes at entrance', a.attributes.access_modes?.join(', ')], ['Coordinates', a.lat ? `${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}` : '—'], ['Source', <span className="text-xs">{a.source}</span>]]} />
            <div className="mt-4"><Notice><Info className="hidden" />{a.data_note}</Notice></div>
          </Card>
          <Card><CardHeader title="Related documents" subtitle="Documents discussing this asset type (topic match)" />
            {!a.related_documents.length ? <EmptyState icon={<FileText className="size-6" />} title="No related documents" /> : (
              <ul className="space-y-2">{a.related_documents.map((d: any) => (
                <li key={d.document_id} className="rounded-lg border border-line p-3 text-[13px]"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{d.title}</span><DocKindBadge kind={d.doc_kind} /><Badge>{d.mentions} mentions</Badge></div>
                  {d.evidence.map((e: any, i: number) => <div key={i} className="mt-1 text-[12.5px] text-ink-700"><span className="text-ink-400">p.{e.page}: </span>{e.excerpt} <a className="text-brand-700" href={fileUrl(d.document_id, e.page)} target="_blank" rel="noreferrer"><ExternalLink className="inline size-3" /></a></div>)}</li>))}
                <li className="text-[11px] text-ink-400">Tender documents describe procurement scope; they are not records of work performed on this specific unit.</li></ul>)}
          </Card>
        </div>
        <div className="space-y-6">
          {isStaff && <Card><CardHeader title="Engineer findings" />{!a.findings.length ? <div className="text-sm text-ink-500">No findings linked to this asset.</div> : a.findings.map((f: any) => <div key={f.id} className="mb-2 text-[13px]"><Link className="font-medium text-brand-700" to={`/app/tickets/${f.ticket_id}`}>Ticket #{f.ticket_id}</Link> — {f.finding}<div className="text-[11px] text-ink-400">{fmtDate(f.created_at)}</div></div>)}</Card>}
          {isStaff && <Card><CardHeader title="Maintenance work" />{!a.maintenance.length ? <div className="text-sm text-ink-500">No work records linked to this asset.</div> : a.maintenance.map((m: any) => <div key={m.id} className="mb-2 text-[13px]"><StatusBadge status={m.status} /> {m.work_type}: {m.description}</div>)}</Card>}
          {isStaff && <Card><CardHeader title="Complaints at station (same category)" />{!a.related_complaints.length ? <div className="text-sm text-ink-500">None.</div> : a.related_complaints.map((c: any) => <Link key={c.id} to={`/app/tickets/${c.ticket_id}`} className="mb-1.5 block text-[13px] hover:text-brand-700"><span className="font-mono text-xs">{c.complaint_code}</span> {c.summary}</Link>)}
            <div className="mt-2 text-[11px] text-ink-400">Complaints are linked by station and category; the specific unit is not identified.</div></Card>}
          {a.same_entrance.length > 0 && <Card><CardHeader title="Same entrance record" />{a.same_entrance.map((x: any) => <Link key={x.id} to={`/app/assets/${x.id}`} className="mb-1 block text-[13px] text-brand-700 hover:underline">{x.name}</Link>)}</Card>}
        </div>
      </div>
    </div>
  )
}
