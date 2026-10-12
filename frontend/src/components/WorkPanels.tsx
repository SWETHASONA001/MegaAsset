import { CheckCircle2, ClipboardCheck, FileText, Link2, Lock, Paperclip, Send, Trash2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, getToken } from '../lib/api'
import { bytes, fmtDate, titleCase } from '../lib/format'
import { emitTicketUpdated } from './StationSidebar'
import { Badge, Button, cx, Field, Input, Modal, Notice, Select, StatusBadge, Textarea, useToast } from './ui'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface WorkSubmission {
  id: number; solution: string; action_taken: string; notes: string | null; status: string; asset: { id: number } | null
  engineer: { full_name: string } | null; reviewer: { full_name: string } | null; review_reason: string | null; review_type: string | null
  reviewed_at: string | null; created_at: string; attachments: { id: number; original_name: string; size_bytes: number; url: string }[]
}

/** Runs a mutating request; on a concurrency conflict (409) it tells the user and reloads the ticket. */
export function useTicketMutation(reload: () => void) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast({ tone: 'success', message: ok }); emitTicketUpdated(); reload(); return true }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast({ tone: 'error', message: msg })
      if (e instanceof ApiError && e.status === 409) reload()
      return false
    } finally { setBusy(false) }
  }
  return { busy, run }
}

async function openProtected(url: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (r.ok) window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener')
}

export function SubmitWorkModal({ open, onClose, ticket, onDone }: { open: boolean; onClose: () => void; ticket: any; onDone: () => void }) {
  const [f, setF] = useState({ solution: '', action_taken: '', notes: '', asset_id: '' })
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { setF({ solution: '', action_taken: '', notes: '', asset_id: ticket?.complaint?.reported_asset?.id ? String(ticket.complaint.reported_asset.id) : '' }); setFiles([]); setError(null) } }, [open, ticket])
  const valid = f.solution.trim().length >= 10 && f.action_taken.trim().length >= 10
  const submit = async () => {
    setBusy(true); setError(null)
    const fd = new FormData()
    fd.append('solution', f.solution); fd.append('action_taken', f.action_taken); if (f.notes) fd.append('notes', f.notes)
    if (f.asset_id) fd.append('asset_id', f.asset_id)
    fd.append('expected_version', String(ticket.version))
    files.forEach((x) => fd.append('files', x, x.name))
    try {
      await api(`/api/tickets/${ticket.id}/work`, { method: 'POST', body: fd })
      toast({ tone: 'success', message: ticket.policy?.require_supervisor_review ? 'Work submitted for supervisor review' : 'Work submitted' })
      emitTicketUpdated(); onDone(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); if (e instanceof ApiError && e.status === 409) onDone() }
    finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Complete work · ${ticket?.ticket_code ?? ''}`} width="max-w-2xl"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={submit} icon={<Send className="size-4" />}>
        {ticket?.policy?.require_supervisor_review ? 'Submit for supervisor review' : 'Submit work'}</Button></>}>
      <div className="space-y-4">
        {ticket?.policy?.require_supervisor_review && <Notice>A supervisor must approve this work before the passenger is asked to confirm the outcome. You cannot approve your own work.</Notice>}
        <Field label="Solution (what fixes the problem)" required hint="At least 10 characters"><Textarea rows={3} value={f.solution} onChange={(e) => setF({ ...f, solution: e.target.value })} /></Field>
        <Field label="Action actually taken on site" required hint="Record what was done, not what is planned"><Textarea rows={3} value={f.action_taken} onChange={(e) => setF({ ...f, action_taken: e.target.value })} /></Field>
        <Field label="Work notes (internal)"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {ticket?.station_assets?.length > 0 && (
          <Field label="Asset worked on" hint="Assets documented at this station (GTFS records)">
            <Select value={f.asset_id} onChange={(e) => setF({ ...f, asset_id: e.target.value })}><option value="">Not specified</option>
              {ticket.station_assets.filter((a: any) => a.asset_type !== 'station_entrance').map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
        )}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-700">Evidence attachments (optional, max 5)</div>
          <Button size="sm" icon={<Paperclip className="size-3.5" />} onClick={() => ref.current?.click()}>Add files</Button>
          <input ref={ref} type="file" hidden multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.docx,.mp4,.webm,.mov" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 5)); e.target.value = '' }} />
          <ul className="mt-2 space-y-1">{files.map((x, i) => <li key={i} className="flex items-center gap-2 text-xs"><FileText className="size-3.5 text-ink-400" />{x.name}<span className="text-ink-400">{bytes(x.size)}</span>
            <button aria-label={`Remove ${x.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-rose-600"><Trash2 className="size-3.5" /></button></li>)}</ul>
        </div>
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </div>
    </Modal>
  )
}

export function ReviewPanel({ ticket, onDone }: { ticket: any; onDone: () => void }) {
  const pending: WorkSubmission | undefined = ticket.work_submissions?.find((w: WorkSubmission) => w.status === 'SUBMITTED')
  const [mode, setMode] = useState<null | 'APPROVED' | 'REJECTED'>(null)
  const [reason, setReason] = useState('')
  const [type, setType] = useState('REWORK')
  const { busy, run } = useTicketMutation(onDone)
  if (!pending) return null
  const p = ticket.permissions
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><ClipboardCheck className="size-4" />Work awaiting supervisor review</div>
      <div className="mt-2 grid gap-3 text-[13px] md:grid-cols-2">
        <div><div className="text-xs text-ink-500">Solution</div><div className="text-ink-900">{pending.solution}</div></div>
        <div><div className="text-xs text-ink-500">Action taken</div><div className="text-ink-900">{pending.action_taken}</div></div>
        {pending.notes && <div className="md:col-span-2"><div className="text-xs text-ink-500">Notes</div><div>{pending.notes}</div></div>}
      </div>
      <div className="mt-2 text-xs text-ink-500">Submitted by {pending.engineer?.full_name} · {fmtDate(pending.created_at)}{pending.attachments.length ? ` · ${pending.attachments.length} attachment(s)` : ''}</div>
      {pending.attachments.length > 0 && <div className="mt-1 flex flex-wrap gap-2">{pending.attachments.map((a) => <button key={a.id} onClick={() => openProtected(a.url)} className="text-xs text-brand-700 underline">{a.original_name}</button>)}</div>}
      {p.review_work ? (
        mode ? (
          <div className="mt-3 space-y-2">
            {mode === 'REJECTED' && <Select value={type} onChange={(e) => setType(e.target.value)} className="w-64"><option value="REWORK">Request rework</option><option value="MORE_EVIDENCE">Request more evidence</option></Select>}
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'REJECTED' ? 'Reason (required)' : 'Comment (optional)'} aria-label="Review reason" />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setMode(null)}>Cancel</Button>
              <Button size="sm" variant={mode === 'APPROVED' ? 'primary' : 'danger'} loading={busy} disabled={mode === 'REJECTED' && reason.trim().length < 5}
                onClick={() => run(() => api(`/api/tickets/${ticket.id}/review`, { method: 'POST', json: { decision: mode, reason: reason || null, review_type: type, expected_version: ticket.version } }),
                  mode === 'APPROVED' ? 'Work approved — passenger asked to confirm' : 'Work returned to the engineer').then((ok) => ok && setMode(null))}>
                {mode === 'APPROVED' ? 'Confirm approval' : 'Return to engineer'}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-2"><Button size="sm" variant="primary" icon={<CheckCircle2 className="size-4" />} onClick={() => setMode('APPROVED')}>Approve work</Button>
            <Button size="sm" variant="danger" icon={<XCircle className="size-4" />} onClick={() => setMode('REJECTED')}>Reject</Button></div>
        )
      ) : (
        <div className="mt-3 text-xs text-amber-900">{p.self_review_blocked ? 'You submitted this work, so a different supervisor must review it.' : 'Waiting for a supervisor to review this work.'}</div>
      )}
    </div>
  )
}

export function WorkHistory({ items }: { items: WorkSubmission[] }) {
  if (!items?.length) return <div className="text-[13px] text-ink-500">No work has been submitted yet.</div>
  return (
    <ul className="space-y-2">
      {items.map((w) => (
        <li key={w.id} className={cx('rounded-lg border p-3 text-[13px]', w.status === 'REJECTED' ? 'border-rose-200' : w.status.startsWith('APPROVED') ? 'border-emerald-200' : 'border-line')}>
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={w.status === 'SUBMITTED' ? 'PENDING_REVIEW' : w.status === 'APPROVED_FAILED' ? 'REOPENED' : w.status} />
            <span className="text-xs text-ink-500">{w.engineer?.full_name} · {fmtDate(w.created_at)}</span></div>
          <div className="mt-1.5"><b>Solution:</b> {w.solution}</div>
          <div className="mt-0.5"><b>Action taken:</b> {w.action_taken}</div>
          {w.notes && <div className="mt-0.5 text-ink-500">{w.notes}</div>}
          {w.attachments.length > 0 && <div className="mt-1 flex flex-wrap gap-2">{w.attachments.map((a) => <button key={a.id} onClick={() => openProtected(a.url)} className="text-xs text-brand-700 underline">{a.original_name}</button>)}</div>}
          {w.reviewer && <div className={cx('mt-2 rounded-md px-2 py-1.5 text-xs', w.status === 'REJECTED' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800')}>
            {w.status === 'REJECTED' ? (w.review_type === 'MORE_EVIDENCE' ? 'More evidence requested' : 'Rework requested') : 'Approved'} by {w.reviewer.full_name} · {fmtDate(w.reviewed_at)}{w.review_reason ? ` — “${w.review_reason}”` : ''}</div>}
          {w.status === 'APPROVED_FAILED' && <div className="mt-1 text-xs text-rose-700">Passenger later reported the issue still exists — kept as a counterexample.</div>}
        </li>
      ))}
    </ul>
  )
}

export function SimilarComplaints({ items }: { items: any[] }) {
  if (!items?.length) return <div className="text-[13px] text-ink-500">No similar complaints above the similarity threshold.</div>
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.id}>
          <Link to={s.ticket_id ? `/app/tickets/${s.ticket_id}` : '#'} className="block rounded-lg border border-line p-3 text-[13px] hover:border-brand-300">
            <div className="flex flex-wrap items-center gap-2"><Link2 className="size-3.5 text-ink-400" /><span className="font-mono text-xs">{s.complaint_code}</span>
              <Badge tone={s.same_station && s.same_category ? 'amber' : 'gray'}>{s.relation}</Badge>
              <Badge tone="violet">similarity {s.similarity.toFixed(2)}</Badge>{s.status && <StatusBadge status={s.status} />}
              <span className="ml-auto text-xs text-ink-400">{s.station} · {fmtDate(s.created_at, false)}</span></div>
            <div className="mt-1 text-ink-700">{s.summary}</div>
            <div className="mt-1 text-[11px] text-ink-400">Why linked: {s.why}</div>
          </Link>
        </li>
      ))}
      <li className="text-[11px] text-ink-400">Linked because the texts read alike. Each complaint stays a separate record; similarity does not confirm the same fault.</li>
    </ul>
  )
}

export function AdminCloseModal({ open, onClose, ticket, onDone }: { open: boolean; onClose: () => void; ticket: any; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const { busy, run } = useTicketMutation(onDone)
  useEffect(() => { if (open) setReason('') }, [open])
  return (
    <Modal open={open} onClose={onClose} title="Administrative closure" footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="danger" loading={busy} disabled={reason.trim().length < 10} icon={<Lock className="size-4" />}
        onClick={() => run(() => api(`/api/tickets/${ticket.id}/admin-close`, { method: 'POST', json: { reason, expected_version: ticket.version } }), 'Ticket administratively closed').then((ok) => ok && onClose())}>Close ticket</Button></>}>
      <Notice tone="warn">This closes the ticket without passenger verification (for example a duplicate or invalid report). It is recorded in the audit log and is <b>not</b> stored as a verified resolution.</Notice>
      <div className="mt-3"><Field label="Reason (required, min. 10 characters)"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      <div className="mt-2 text-xs text-ink-500">Current status: {titleCase(ticket?.status)}</div>
    </Modal>
  )
}

export function VersionNote({ version }: { version: number }) {
  return <span className="text-[11px] text-ink-400" title="Optimistic concurrency: actions are rejected if someone else changed the ticket first">rev {version}</span>
}

export { Input }
