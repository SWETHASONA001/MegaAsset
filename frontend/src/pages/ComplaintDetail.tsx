import { ArrowLeft, CheckCircle2, ExternalLink, FileText, Film, MapPin, RotateCcw, ThumbsDown, ThumbsUp, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Timeline } from '../components/evidence'
import { Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, Field, KeyValue, LoadingBlock, Notice, PageHeader, PriorityBadge, ProvenanceBadge, StatusBadge, Textarea, useToast } from '../components/ui'
import { api, getToken } from '../lib/api'
import { useAuth } from '../lib/auth'
import { bytes, fmtDate } from '../lib/format'
import { useApi } from '../lib/hooks'

interface Att { id: number; kind: string; original_name: string; mime_type: string; size_bytes: number; url: string }

/** Attachments require auth headers, so they are fetched as blobs and shown via object URLs. */
function useBlobUrl(url: string, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let revoke: string | null = null
    fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } }).then((r) => r.ok ? r.blob() : null).then((b) => { if (b) { revoke = URL.createObjectURL(b); setSrc(revoke) } }).catch(() => {})
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [url, enabled])
  return src
}

function AttachmentTile({ a }: { a: Att }) {
  const src = useBlobUrl(a.url, a.kind !== 'document')
  const open = async () => {
    const r = await fetch(a.url, { headers: { Authorization: `Bearer ${getToken()}` } })
    if (!r.ok) return
    const u = URL.createObjectURL(await r.blob())
    window.open(u, '_blank', 'noopener')
  }
  return (
    <button onClick={open} className="group overflow-hidden rounded-lg border border-line bg-white text-left hover:border-brand-300">
      {a.kind === 'image' ? (src ? <img src={src} alt={a.original_name} className="h-28 w-full object-cover" /> : <div className="skeleton h-28" />)
        : a.kind === 'video' ? (src ? <video src={src} className="h-28 w-full bg-black object-cover" muted /> : <div className="flex h-28 items-center justify-center bg-slate-900 text-white"><Film className="size-6" /></div>)
          : <div className="flex h-28 items-center justify-center bg-slate-50 text-ink-400"><FileText className="size-8" /></div>}
      <div className="flex items-center gap-1 px-2 py-1.5 text-[11px]"><span className="min-w-0 flex-1 truncate">{a.original_name}</span><span className="text-ink-400">{bytes(a.size_bytes)}</span><ExternalLink className="size-3 text-ink-400" /></div>
    </button>
  )
}

export function AttachmentGallery({ items }: { items: Att[] }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{items.map((a) => <AttachmentTile key={a.id} a={a} />)}</div>
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function ComplaintDetail() {
  const { id } = useParams()
  const { isStaff } = useAuth()
  const { data: c, error, loading, reload } = useApi<any>(`/api/complaints/${id}`)
  const [confirm, setConfirm] = useState<null | 'RESOLVED' | 'STILL_EXISTS' | 'REOPEN'>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !c) return <LoadingBlock rows={6} />
  const t = c.ticket
  const submit = async () => {
    if (!confirm || !t) return
    setBusy(true)
    try {
      if (confirm === 'REOPEN') await api(`/api/tickets/${t.id}/actions`, { method: 'POST', json: { action: 'reopen', note: comment || 'Passenger reports the issue has returned' } })
      else await api(`/api/tickets/${t.id}/verify`, { method: 'POST', json: { outcome: confirm, comment: comment || null } })
      toast({ tone: 'success', message: confirm === 'RESOLVED' ? 'Thank you — marked as resolved' : 'Ticket reopened for further work' })
      setConfirm(null); setComment(''); reload(true)
    } catch (e) { toast({ tone: 'error', message: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }
  return (
    <div>
      <Link to={isStaff ? '/app/complaints' : '/app/my-complaints'} className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900"><ArrowLeft className="size-3.5" />Back</Link>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{c.complaint_code}</span>{t && <StatusBadge status={t.status} />}</span>}
        description={<>{c.category_label?.en} · <MapPin className="inline size-3.5" /> {c.station?.name} · submitted {fmtDate(c.created_at)}</>}
        actions={isStaff && t && <Link to={`/app/tickets/${t.id}`}><Button variant="primary" icon={<Ticket className="size-4" />}>Open ticket workspace</Button></Link>} />

      {c.can_verify && (
        <Card className="mb-6 border-teal-200 bg-gradient-to-r from-teal-50 to-white">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div><div className="text-base font-semibold">Is your issue resolved?</div><div className="mt-0.5 text-sm text-ink-500">The team reports that work on this complaint is complete. Your answer decides whether the ticket is resolved or reopened.</div></div>
            <div className="flex gap-2"><Button variant="primary" icon={<ThumbsUp className="size-4" />} onClick={() => setConfirm('RESOLVED')}>Issue Resolved</Button><Button variant="danger" icon={<ThumbsDown className="size-4" />} onClick={() => setConfirm('STILL_EXISTS')}>Issue Still Exists</Button></div>
          </div>
        </Card>
      )}
      {c.can_reopen && <div className="mb-6"><Notice>Did the problem come back? <button className="font-semibold underline" onClick={() => setConfirm('REOPEN')}>Reopen this ticket</button>.</Notice></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Your report" action={<ProvenanceBadge label="REPORTED" />} />
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{c.description}</p>
            {c.attachments.length > 0 && <div className="mt-4"><AttachmentGallery items={c.attachments} /></div>}
          </Card>
          <Card>
            <CardHeader title="Progress" subtitle="Updates recorded on your ticket" />
            {c.timeline?.length ? <Timeline events={[...c.timeline].reverse().map((e: any, i: number) => ({ ...e, id: i }))} /> : <div className="text-sm text-ink-500">No updates yet.</div>}
          </Card>
        </div>
        <Card>
          <CardHeader title="Ticket" />
          {t ? <KeyValue cols={1} items={[
            ['Ticket ID', <span className="font-mono">{t.ticket_code}</span>], ['Complaint ID', <span className="font-mono">{c.complaint_code}</span>],
            ['Status', <StatusBadge status={t.status} />], ['Priority', <PriorityBadge priority={t.priority} />],
            ['Assigned team', t.assigned_team ?? 'Not yet assigned'], ['Station', c.station?.name], ['Category', <>{c.category_label?.en} <span className="text-ink-500">/ {c.category_label?.ta}</span></>],
            ['Language', c.language === 'ta' ? 'Tamil' : 'English'], ['Last updated', fmtDate(t.updated_at)]]} /> : <div className="text-sm text-ink-500">No ticket linked.</div>}
          {t?.status === 'RESOLVED' && <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 className="size-4" />Verified resolved</div>}
          {t?.reopen_count > 0 && <div className="mt-3"><Badge tone="red"><RotateCcw className="size-3" />Reopened {t.reopen_count}×</Badge></div>}
        </Card>
      </div>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} loading={busy} onConfirm={submit}
        title={confirm === 'RESOLVED' ? 'Confirm the issue is resolved' : confirm === 'REOPEN' ? 'Reopen ticket' : 'Report that the issue still exists'}
        tone={confirm === 'RESOLVED' ? 'primary' : 'danger'} confirmLabel={confirm === 'RESOLVED' ? 'Yes, resolved' : 'Reopen ticket'}
        message={confirm === 'RESOLVED' ? 'Your confirmation will be stored and the ticket marked resolved.' : 'The ticket will be reopened and the operations team notified.'}>
        <Field label="Comment (optional)"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  )
}
