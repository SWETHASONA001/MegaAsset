import { Activity, AlertCircle, ArrowRight, Brain, Building2, CheckCircle2, ClipboardCheck, FileSearch, FileText, MessageSquarePlus, Network, Ticket } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { axisProps, BarList, ChartTooltip, gridProps, SEQ, STATUS_COLOURS } from '../components/charts'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, ProvenanceBadge, Stat } from '../components/ui'
import { useAuth } from '../lib/auth'
import { compact, fmtNum, timeAgo, titleCase } from '../lib/format'
import { useApi } from '../lib/hooks'

interface OverviewData {
  scope: 'all' | 'mine'
  tickets: { total: number; resolved?: number; open: number; this_week: number; awaiting_verification: number; by_status: Record<string, number>; by_category: Record<string, number>; by_station: Record<string, number>; open_by_priority: Record<string, number>; daily: { date: string; count: number }[] }
  documents: { indexed: number; total: number; chunks: number; pages: number }
  stations: number; assets: number; graph: { entities: number; relationships: number }
  investigations: number | null; pending_approvals: number | null; resolutions: Record<string, number> | null
  ridership: { month: string; total: number }[]
  activity: { id: number; event_type: string; ticket_id: number; ticket_code: string; note: string | null; to_status: string | null; actor: { full_name: string } | null; created_at: string }[]
}

const raise = () => window.dispatchEvent(new Event('megaasset:raise-complaint'))

export default function Overview() {
  const { user, isStaff } = useAuth()
  const { data, error, loading, reload } = useApi<OverviewData>('/api/overview')
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <><PageHeader title="Overview" /><LoadingBlock rows={6} /></>
  const t = data.tickets
  const statusData = Object.entries(t.by_status).map(([k, v]) => ({ status: titleCase(k), key: k, count: v }))
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      <PageHeader eyebrow={isStaff ? 'Operations workspace' : 'Passenger workspace'} title={`${greeting}, ${user?.full_name.split(' ')[0]}`}
        description={isStaff ? 'Live view of complaints, tickets, document intelligence and investigations — every figure below is computed from records in the platform database.'
          : 'Raise a complaint, follow your tickets and confirm when issues are resolved. Everything here is about your own complaints.'}
        actions={<>
          {isStaff && <Link to="/app/assistant"><Button icon={<FileSearch className="size-4" />}>Ask the documents</Button></Link>}
          <Button variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={raise}>Raise a Complaint</Button>
        </>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={isStaff ? 'Open tickets' : 'My open tickets'} value={fmtNum(t.open)} hint={`${fmtNum(t.total)} total · ${t.this_week} this week`} icon={<Ticket className="size-4" />} to="/app/tickets" />
        <Stat label="Awaiting verification" value={fmtNum(t.awaiting_verification)} hint={isStaff ? 'Passenger confirmation pending' : 'Please confirm if resolved'} icon={<ClipboardCheck className="size-4" />} tone={t.awaiting_verification ? 'warn' : 'default'} to={isStaff ? '/app/tickets?status=AWAITING_VERIFICATION' : '/app/my-complaints'} />
        {isStaff ? <Stat label="Indexed documents" value={fmtNum(data.documents.indexed)} hint={`${fmtNum(data.documents.pages)} pages · ${fmtNum(data.documents.chunks)} passages`} icon={<FileText className="size-4" />} tone="violet" to="/app/documents" />
          : <Stat label="Resolved / closed" value={fmtNum(t.resolved ?? 0)} hint="Confirmed by you or closed" icon={<CheckCircle2 className="size-4" />} tone="good" to="/app/my-complaints" />}
        {isStaff ? <Stat label="Pending approvals" value={fmtNum(data.pending_approvals)} hint={`${fmtNum(data.investigations)} investigations run`} icon={<Brain className="size-4" />} tone={data.pending_approvals ? 'warn' : 'brand'} to="/app/investigations" />
          : <Stat label="Complaints raised" value={fmtNum(t.total)} hint={`${t.this_week} this week`} icon={<MessageSquarePlus className="size-4" />} tone="brand" to="/app/my-complaints" />}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={isStaff ? 'Ticket intake — last 30 days' : 'My complaints — last 30 days'} subtitle="Tickets created per day (PROCESSED from ticket records)" action={<ProvenanceBadge label="PROCESSED" />} />
          {t.total === 0 ? (
            <EmptyState icon={<Ticket className="size-6" />} title="No complaints yet" description="Ticket charts appear once complaints are submitted. No sample or synthetic tickets are generated."
              action={<Button variant="primary" onClick={raise} icon={<MessageSquarePlus className="size-4" />}>Raise the first complaint</Button>} />
          ) : (
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={t.daily} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SEQ[4]} stopOpacity={0.25} /><stop offset="100%" stopColor={SEQ[4]} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => d.slice(5)} interval={4} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="count" name="Tickets" stroke={SEQ[5]} strokeWidth={2} fill="url(#ga)" activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Tickets by status" subtitle="Current lifecycle distribution" />
          {statusData.length === 0 ? <EmptyState title="No tickets" description="Status distribution appears after the first complaint." /> : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={statusData} layout="vertical" margin={{ left: 40, right: 16 }}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis type="category" dataKey="status" {...axisProps} width={110} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="count" name="Tickets" radius={[0, 4, 4, 0]} barSize={14} fill={SEQ[4]}
                    shape={(p: unknown) => { const q = p as { x: number; y: number; width: number; height: number; payload: { key: string } }; return <rect x={q.x} y={q.y} width={Math.max(q.width, 2)} height={q.height} rx={4} fill={STATUS_COLOURS[q.payload.key] ?? SEQ[4]} /> }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Complaints by category" subtitle="Passenger-reported categories" action={<ProvenanceBadge label="REPORTED" />} />
          {Object.keys(t.by_category).length === 0 ? <EmptyState title="No data yet" /> :
            <BarList items={Object.entries(t.by_category).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }))} />}
        </Card>
        <Card>
          <CardHeader title={isStaff ? 'Stations with most tickets' : 'My complaints by station'} subtitle={isStaff ? 'Top stations by ticket count' : 'Where you have reported issues'} action={<ProvenanceBadge label="PROCESSED" />} />
          {Object.keys(t.by_station).length === 0 ? <EmptyState title="No data yet" /> :
            <BarList items={Object.entries(t.by_station).map(([k, v]) => ({ label: k, value: v }))} />}
        </Card>
        <Card>
          <CardHeader title="Recent activity" subtitle="Latest ticket events" icon={<Activity className="size-4" />} />
          {data.activity.length === 0 ? <EmptyState title="No activity yet" /> : (
            <ul className="space-y-3">
              {data.activity.slice(0, 7).map((a) => (
                <li key={a.id} className="flex gap-3 text-[13px]">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0">
                    <Link to={isStaff ? `/app/tickets/${a.ticket_id}` : '/app/my-complaints'} className="font-medium text-ink-900 hover:text-brand-700">{a.ticket_code}</Link>
                    <span className="text-ink-500"> · {titleCase(a.event_type)}{a.to_status ? ` → ${titleCase(a.to_status)}` : ''}</span>
                    <div className="text-[11px] text-ink-400">{timeAgo(a.created_at)}{a.actor ? ` · ${a.actor.full_name}` : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isStaff && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Network ridership" subtitle="Monthly total passenger flow — data/raw/cmrl/ridership/cmrl_monthly_ridership.csv" action={<ProvenanceBadge label="DOCUMENTED" />} />
            <RidershipMini data={data.ridership} tall />
          </Card>
          <Card>
            <CardHeader title="Intelligence coverage" subtitle="Knowledge base built from workspace data" />
            <ul className="space-y-3 text-sm">
              {[[<Building2 className="size-4" />, 'Stations (GTFS)', data.stations, '/app/stations'], [<Network className="size-4" />, 'Graph entities', data.graph.entities, '/app/knowledge-graph'],
                [<Network className="size-4" />, 'Traceable relationships', data.graph.relationships, '/app/knowledge-graph'], [<FileText className="size-4" />, 'Documented access assets', data.assets, '/app/assets'],
                [<CheckCircle2 className="size-4" />, 'Verified resolutions', data.resolutions?.VERIFIED_RESOLVED ?? 0, '/app/resolution-memory'],
                [<AlertCircle className="size-4" />, 'Reopened counterexamples', data.resolutions?.FAILED_REOPENED ?? 0, '/app/resolution-memory']].map(([icon, label, v, to], i) => (
                <li key={i}><Link to={to as string} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <span className="flex items-center gap-2.5 text-ink-700"><span className="text-brand-600">{icon}</span>{label}</span>
                  <span className="flex items-center gap-2 font-semibold tabular-nums">{fmtNum(v as number)}<ArrowRight className="size-3.5 text-ink-400" /></span>
                </Link></li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {!isStaff && t.awaiting_verification > 0 && (
        <div className="mt-6"><Card className="border-teal-200 bg-teal-50/50"><div className="flex items-center justify-between gap-4"><div><div className="font-semibold">You have {t.awaiting_verification} ticket(s) awaiting your confirmation</div><div className="text-sm text-ink-500">Tell us whether the issue is resolved or still exists.</div></div><Link to="/app/my-complaints"><Button variant="primary">Review now</Button></Link></div></Card></div>
      )}
    </div>
  )
}

function RidershipMini({ data, tall }: { data: { month: string; total: number }[]; tall?: boolean }) {
  if (!data.length) return <EmptyState title="Ridership data not loaded" description="Dataset processing has not completed yet." />
  return (
    <div className={tall ? 'h-60' : 'h-48'}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -10, right: 4, top: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" {...axisProps} interval={tall ? 2 : 5} />
          <YAxis {...axisProps} tickFormatter={(v: number) => compact(v)} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="total" name="Passengers" fill={SEQ[4]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {!tall && <div className="mt-1 text-[11px] text-ink-400"><Badge tone="brand">DOCUMENTED</Badge> Source: cmrl_monthly_ridership.csv</div>}
    </div>
  )
}
