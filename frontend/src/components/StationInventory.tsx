import { AlertTriangle, FileText, Layers } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useApi } from '../lib/hooks'
import { titleCase } from '../lib/format'
import { Badge, cx, LoadingBlock, PriorityBadge, SectionTitle, StatusBadge } from './ui'

/* eslint-disable @typescript-eslint/no-explicit-any */
export function StationInventory({ stationId, compact = false }: { stationId: number; compact?: boolean }) {
  const { data, error, loading } = useApi<any>(`/api/stations/${stationId}/inventory`, [stationId])
  if (error) return <div className="text-sm text-rose-600">{error}</div>
  if (loading || !data) return <LoadingBlock rows={3} />
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Asset inventory by reliability</SectionTitle>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[12.5px]">
            <thead className="bg-slate-50 text-[11px] text-ink-500">
              <tr><th className="px-2.5 py-1.5 text-left font-medium">Asset type</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Confirmed by an engineer finding or approved work">Verified</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Referenced in documents / GTFS records">Document-derived</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Complaints that report this asset type">Reported</th>
                {!compact && <th className="px-2.5 py-1.5 text-left font-medium">Inventory status</th>}</tr>
            </thead>
            <tbody>
              {data.categories.map((c: any) => (
                <tr key={c.asset_type} className="border-t border-line" title={[c.document_basis, c.reported_basis].filter(Boolean).join(' · ')}>
                  <td className="px-2.5 py-1.5 font-medium">{c.label}</td>
                  <td className={cx('px-2 py-1.5 text-right tabular-nums', c.verified_count ? 'font-semibold text-emerald-700' : 'text-ink-400')}>{c.verified_count}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.document_derived_count || <span className="text-ink-400">—</span>}</td>
                  <td className={cx('px-2 py-1.5 text-right tabular-nums', c.reported_unverified ? 'text-amber-700' : 'text-ink-400')}>{c.reported_unverified}</td>
                  {!compact && <td className="px-2.5 py-1.5 text-ink-500">{c.inventory_status}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-1.5 text-[11px] text-ink-400">{data.note} Document-derived counts are references in GTFS entrance descriptions, not physical unit counts.</div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 py-2"><div className="text-lg font-semibold tabular-nums">{data.open_complaints}</div><div className="text-[10.5px] text-ink-500">active complaints</div></div>
        <div className="rounded-lg bg-slate-50 py-2"><div className="text-lg font-semibold tabular-nums">{data.open_tickets}</div><div className="text-[10.5px] text-ink-500">open tickets</div></div>
        <div className="rounded-lg bg-slate-50 py-2"><div className="text-lg font-semibold tabular-nums">{data.total_complaints}</div><div className="text-[10.5px] text-ink-500">all-time complaints</div></div>
      </div>
      {data.active_items.length > 0 && (
        <div><SectionTitle>Open tickets</SectionTitle>
          <ul className="space-y-1">{data.active_items.map((a: any) => (
            <li key={a.ticket_id}><Link to={`/app/tickets/${a.ticket_id}`} className="flex flex-wrap items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-slate-50">
              <span className="font-mono text-[11px]">{a.ticket_code}</span><StatusBadge status={a.status} /><PriorityBadge priority={a.priority} />
              <span className="min-w-0 flex-1 truncate text-ink-600">{a.summary}</span></Link></li>))}</ul></div>
      )}
      {data.repeated_groups.length > 0 && (
        <div><SectionTitle>Repeated complaint groups</SectionTitle>
          {data.repeated_groups.map((g: any, i: number) => (
            <div key={i} className="mb-2 rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 text-[12.5px]">
              <div className="font-medium">{g.size} similar active complaints · {g.categories.map(titleCase).join(', ')} <span className="font-normal text-ink-500">(min. similarity {g.min_similarity})</span></div>
              <ul className="mt-1 space-y-0.5">{g.complaints.map((c: any) => <li key={c.id}><Link className="text-brand-700 hover:underline" to={`/app/tickets/${c.ticket_id}`}>{c.complaint_code}</Link> <span className="text-ink-600">{c.summary}</span></li>)}</ul>
              <div className="mt-1 text-[11px] text-ink-500">{g.note}</div>
            </div>))}
        </div>
      )}
      {data.documents.length > 0 && (
        <div><SectionTitle>Documents mentioning this station</SectionTitle>
          <ul className="space-y-1">{data.documents.slice(0, compact ? 5 : 10).map((d: any) => (
            <li key={d.document_id}><Link to={`/app/documents?doc=${d.document_id}`} className="flex items-center gap-1.5 text-[12.5px] hover:text-brand-700"><FileText className="size-3.5 text-ink-400" /><span className="truncate">{d.title}</span><Badge tone="gray">{d.mentions}×</Badge></Link></li>))}</ul></div>
      )}
      {(data.investigations.length > 0 || data.resolutions.length > 0) && (
        <div><SectionTitle>Investigations & resolutions</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {data.investigations.map((i: any) => <Link key={i.id} to={`/app/investigations/${i.id}`}><Badge tone="gray">{i.code} · {titleCase(i.status)}</Badge></Link>)}
            {data.resolutions.map((r: any) => <Link key={r.id} to={`/app/tickets/${r.ticket_id}`}><Badge tone={r.outcome === 'VERIFIED_RESOLVED' ? 'green' : 'red'}>{titleCase(r.outcome)}</Badge></Link>)}
          </div></div>
      )}
      <div><SectionTitle>Missing inventory or evidence</SectionTitle>
        <ul className="space-y-1 text-[12px] text-ink-600">{data.missing.map((m: string) => <li key={m} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />{m}</li>)}</ul></div>
      {compact && <Link to={`/app/stations/${stationId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><Layers className="size-3.5" />Open station page</Link>}
    </div>
  )
}
