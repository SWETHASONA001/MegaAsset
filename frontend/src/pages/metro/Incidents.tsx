import { Siren } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, PriorityBadge, ProvenanceBadge, StatusBadge } from '../../components/ui'
import { fmtDate } from '../../lib/format'
import { useApi } from '../../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Incidents() {
  const { data, error, loading, reload } = useApi<any>('/api/operations/incidents')
  if (error) return <ErrorState message={error} onRetry={reload} />
  return (
    <div>
      <PageHeader eyebrow="Metro operations" title="Incidents" description="Verified incidents only — recorded when an engineer confirms an incident in a ticket finding." />
      <Notice>{data?.note ?? 'Passenger complaints alone are not treated as incidents.'} No historical incident dataset exists in the workspace, so none is shown or invented.</Notice>
      <div className="mt-5">
        {loading || !data ? <LoadingBlock /> : !data.items.length ? (
          <EmptyState icon={<Siren className="size-6" />} title="No verified incidents recorded" description="When an engineer adds a finding with “incident confirmed”, the incident appears here with its ticket, station and evidence trail."
            action={<Link to="/app/tickets" className="text-sm font-medium text-brand-700 hover:underline">Go to tickets</Link>} />
        ) : (
          <Card padded={false}><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-slate-50/60 text-xs text-ink-500"><tr><th className="px-4 py-2.5 text-left font-medium">Incident</th><th className="px-4 py-2.5 text-left font-medium">Station</th><th className="px-4 py-2.5 text-left font-medium">Severity</th><th className="px-4 py-2.5 text-left font-medium">Status</th><th className="px-4 py-2.5 text-left font-medium">Recorded</th><th className="px-4 py-2.5 text-left font-medium">Ticket</th></tr></thead>
            <tbody className="divide-y divide-line">{data.items.map((i: any) => (
              <tr key={i.id}><td className="px-4 py-3"><div className="font-mono text-xs text-ink-500">{i.code}</div><div className="font-medium">{i.title}</div><div className="mt-0.5 line-clamp-2 text-xs text-ink-500">{i.description}</div><div className="mt-1"><ProvenanceBadge label={i.provenance} /></div></td>
                <td className="px-4 py-3">{i.station?.name}</td><td className="px-4 py-3"><PriorityBadge priority={i.severity} /></td><td className="px-4 py-3"><StatusBadge status={i.status} /></td>
                <td className="px-4 py-3 text-xs text-ink-500">{fmtDate(i.created_at)}<div>{i.recorded_by?.full_name}</div></td>
                <td className="px-4 py-3">{i.ticket_id && <Link className="text-brand-700 hover:underline" to={`/app/tickets/${i.ticket_id}`}>Open</Link>}</td></tr>))}</tbody></table></div></Card>
        )}
      </div>
    </div>
  )
}
