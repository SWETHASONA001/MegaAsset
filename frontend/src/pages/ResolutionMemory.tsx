import { CheckCircle2, History, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, ProvenanceBadge, Stat, Tabs } from '../components/ui'
import { fmtDate } from '../lib/format'
import { useApi } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function ResolutionMemory() {
  const [tab, setTab] = useState<'' | 'VERIFIED_RESOLVED' | 'FAILED_REOPENED'>('')
  const { data, error, loading, reload } = useApi<any>(`/api/resolution-memory${tab ? `?outcome=${tab}` : ''}`)
  if (error) return <ErrorState message={error} onRetry={reload} />
  return (
    <div>
      <PageHeader eyebrow="Intelligence" title="Resolution memory" description="Cases stored only after human verification: passenger-confirmed resolutions, plus reopened cases kept as counterexamples. Unverified recommendations are never stored as successes." />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Verified resolutions" value={data?.counts?.VERIFIED_RESOLVED ?? 0} icon={<CheckCircle2 className="size-4" />} tone="good" />
        <Stat label="Counterexamples (reopened)" value={data?.counts?.FAILED_REOPENED ?? 0} icon={<RotateCcw className="size-4" />} tone="warn" />
        <Stat label="Used by" value="Investigations" hint="Similar cases inform — but never decide — new recommendations" icon={<History className="size-4" />} />
      </div>
      <div className="mt-6"><Tabs value={tab} onChange={setTab} tabs={[{ value: '', label: 'All' }, { value: 'VERIFIED_RESOLVED', label: 'Verified' }, { value: 'FAILED_REOPENED', label: 'Counterexamples' }]} /></div>
      <div className="mt-5">
        {loading || !data ? <LoadingBlock /> : !data.items.length ? (
          <EmptyState icon={<History className="size-6" />} title="No verified cases yet" description="A case is stored when a passenger confirms a ticket is resolved, or when a ticket with an attempted action is reopened." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">{data.items.map((m: any) => (
            <Card key={m.id}>
              <div className="flex flex-wrap items-center gap-2"><Badge tone={m.outcome === 'VERIFIED_RESOLVED' ? 'green' : 'red'}>{m.outcome === 'VERIFIED_RESOLVED' ? 'Verified resolved' : 'Failed / reopened'}</Badge><ProvenanceBadge label={m.provenance} /><Badge>{m.category_label}</Badge>
                <span className="ml-auto text-xs text-ink-400">{fmtDate(m.created_at)}</span></div>
              <div className="mt-2 text-[13px] text-ink-900">{m.problem_summary}</div>
              <div className="mt-2 text-[13px]"><span className="font-semibold">Action:</span> {m.approved_action ?? <span className="text-ink-500">No approved solution recorded</span>}</div>
              {m.findings.length > 0 && <ul className="mt-2 list-disc pl-4 text-[12.5px] text-ink-700">{m.findings.map((f: string, k: number) => <li key={k}>{f}</li>)}</ul>}
              <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-2 text-xs text-ink-500"><span>{m.station?.name}</span>{m.reviewer && <span>Approved by {m.reviewer.full_name}</span>}<span>{m.evidence.length} evidence refs</span>
                <Link className="ml-auto font-medium text-brand-700" to={`/app/tickets/${m.ticket_id}`}>{m.ticket_code}</Link></div>
            </Card>))}</div>
        )}
      </div>
    </div>
  )
}
