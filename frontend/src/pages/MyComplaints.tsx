import { ChevronRight, ClipboardCheck, MapPin, MessageSquarePlus, Paperclip } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '../components/ui'
import { fmtDate, timeAgo } from '../lib/format'
import { useApi } from '../lib/hooks'

interface C { id: number; complaint_code: string; description: string; category_label: { en: string; ta: string }; station: { name: string }; created_at: string; language: string; attachments: unknown[]
  ticket: { id: number; ticket_code: string; status: string; priority: string; updated_at: string } | null }

export default function MyComplaints() {
  const { data, error, loading, reload } = useApi<{ total: number; items: C[] }>('/api/complaints?mine=true&page_size=100')
  useEffect(() => { const h = () => reload(true); window.addEventListener('megaasset:complaint-created', h); return () => window.removeEventListener('megaasset:complaint-created', h) }, [reload])
  const raise = () => window.dispatchEvent(new Event('megaasset:raise-complaint'))
  const awaiting = data?.items.filter((c) => c.ticket?.status === 'AWAITING_VERIFICATION') ?? []
  return (
    <div>
      <PageHeader eyebrow="Complaint history" title="My complaints" description="Everything you have reported, with the live status of each ticket."
        actions={<Button variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={raise}>Raise a Complaint</Button>} />
      {error ? <ErrorState message={error} onRetry={reload} /> : loading ? <LoadingBlock /> : !data?.items.length ? (
        <EmptyState icon={<MessageSquarePlus className="size-6" />} title="You haven't raised any complaints" description="Report an issue at any CMRL station. You'll get a complaint ID and can track the ticket here."
          action={<Button variant="primary" onClick={raise}>Raise a Complaint</Button>} />
      ) : (
        <>
          {awaiting.length > 0 && (
            <Card className="mb-5 border-teal-200 bg-teal-50/60"><div className="flex items-center gap-3"><ClipboardCheck className="size-5 text-teal-700" /><div className="text-sm"><b>{awaiting.length}</b> ticket(s) need your confirmation. Open them to tell us whether the issue is resolved.</div></div></Card>
          )}
          <div className="grid gap-3">
            {data.items.map((c) => (
              <Link key={c.id} to={`/app/complaints/${c.id}`}>
                <Card className="transition hover:border-brand-200 hover:shadow-pop">
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{c.complaint_code}</span>
                        {c.ticket && <span className="font-mono text-xs text-ink-400">{c.ticket.ticket_code}</span>}
                        {c.ticket && <StatusBadge status={c.ticket.status} />}
                        <Badge>{c.category_label.en}</Badge>
                        {c.ticket?.status === 'AWAITING_VERIFICATION' && <Badge tone="teal">Action needed</Badge>}
                      </div>
                      <p className="mt-2 line-clamp-2 text-[13.5px] text-ink-700">{c.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                        <span className="flex items-center gap-1"><MapPin className="size-3" />{c.station.name}</span>
                        <span>Submitted {fmtDate(c.created_at, false)}</span>
                        {c.ticket && <span>Updated {timeAgo(c.ticket.updated_at)}</span>}
                        {c.attachments.length > 0 && <span className="flex items-center gap-1"><Paperclip className="size-3" />{c.attachments.length}</span>}
                      </div>
                    </div>
                    <ChevronRight className="mt-1 size-5 text-ink-400" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
