import { ExternalLink, FileText, ScanText, Table2 } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import { fileUrl } from '../lib/api'
import { fmtDate, titleCase } from '../lib/format'
import { Badge, cx, ProvenanceBadge } from './ui'

export interface Citation {
  n: number; chunk_id: number; document_id: number; title: string; filename: string; category: string; doc_kind: string
  page: number | null; heading: string | null; sheet: string | null; row_start: number | null; row_end: number | null
  location: string; excerpt: string; ocr: boolean; provenance: string; verified?: boolean; vector_score?: number | null
}

export function DocKindBadge({ kind }: { kind?: string | null }) {
  if (!kind) return null
  const tone = kind.startsWith('TENDER') ? 'amber' : kind === 'ANNUAL_REPORT' ? 'brand' : kind === 'DATA_TABLE' ? 'teal' : 'gray'
  return <Badge tone={tone}>{titleCase(kind)}</Badge>
}

export function CitationCard({ c, active, onOpen }: { c: Citation; active?: boolean; onOpen?: (c: Citation) => void }) {
  return (
    <div id={`cite-${c.n}`} className={cx('rounded-lg border bg-white p-3 transition', active ? 'border-brand-300 ring-2 ring-brand-100' : 'border-line')}>
      <div className="flex items-start gap-2">
        <span className="cite-chip !mx-0 shrink-0">{c.n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-ink-900" title={c.filename}>{c.filename}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
            {c.sheet ? <Table2 className="size-3" /> : <FileText className="size-3" />}
            <span className="font-medium text-ink-700">{c.location}</span>
            {c.heading && !c.sheet && <span className="truncate">· {c.heading.slice(0, 60)}</span>}
          </div>
        </div>
      </div>
      <blockquote className="mt-2 border-l-2 border-brand-200 pl-2.5 text-[12.5px] leading-relaxed text-ink-700">“{c.excerpt}”</blockquote>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ProvenanceBadge label={c.provenance} />
        <DocKindBadge kind={c.doc_kind} />
        {c.ocr && <Badge tone="violet"><ScanText className="size-3" />OCR</Badge>}
        {c.verified && <Badge tone="green">Quote verified</Badge>}
        <span className="ml-auto flex gap-2">
          {onOpen && <button onClick={() => onOpen(c)} className="text-[11px] font-medium text-brand-700 hover:underline">Preview</button>}
          <a href={fileUrl(c.document_id, c.sheet ? null : c.page)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline">
            Open {c.page && !c.sheet ? `p.${c.page}` : 'file'}<ExternalLink className="size-3" />
          </a>
        </span>
      </div>
    </div>
  )
}

/** Renders the assistant's lightweight markdown (bold, italics, bullets) with clickable [n] citation chips. */
export function AnswerText({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  const inline = (s: string, key: string): ReactNode[] => {
    const out: ReactNode[] = []
    const re = /(\*\*[^*]+\*\*|_[^_]+_|\[\d+\])/g
    let last = 0; let m: RegExpExecArray | null; let i = 0
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index))
      const tok = m[0]
      if (tok.startsWith('**')) out.push(<strong key={`${key}-${i}`}>{tok.slice(2, -2)}</strong>)
      else if (tok.startsWith('_')) out.push(<em key={`${key}-${i}`}>{tok.slice(1, -1)}</em>)
      else { const n = Number(tok.slice(1, -1)); out.push(<button key={`${key}-${i}`} className="cite-chip" onClick={() => onCite?.(n)} aria-label={`Citation ${n}`}>{n}</button>) }
      last = m.index + tok.length; i++
    }
    if (last < s.length) out.push(s.slice(last))
    return out
  }
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []
  const flush = (k: number) => { if (list.length) { blocks.push(<ul key={`ul-${k}`}>{list}</ul>); list = [] } }
  lines.forEach((ln, k) => {
    const t = ln.trimEnd()
    if (/^\s*-\s+/.test(t)) {
      const nested = /^\s{2,}-/.test(t)
      list.push(<li key={k} className={nested ? 'ml-4 text-ink-500' : ''}>{inline(t.replace(/^\s*-\s+/, ''), `l${k}`)}</li>)
    } else {
      flush(k)
      if (t.trim()) blocks.push(<p key={k}>{inline(t, `p${k}`)}</p>)
    }
  })
  flush(lines.length)
  return <div className="prose-answer text-[13.5px] leading-relaxed text-ink-700">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}

export interface TimelineEvent { id: number | string; event_type: string; note?: string | null; to_status?: string | null; from_status?: string | null; created_at: string; actor?: { full_name: string; role: string } | null }
const EVENT_TONE: Record<string, string> = {
  COMPLAINT_RECEIVED: 'bg-sky-500', ASSIGNED: 'bg-indigo-500', STATUS_CHANGE: 'bg-violet-500', FINDING_ADDED: 'bg-amber-500',
  SOLUTION_PROPOSED: 'bg-amber-500', SOLUTION_APPROVED: 'bg-emerald-500', SOLUTION_REJECTED: 'bg-rose-500', VERIFICATION_REQUESTED: 'bg-teal-500',
  VERIFIED_RESOLVED: 'bg-emerald-600', VERIFIED_STILL_EXISTS: 'bg-rose-500', REOPENED: 'bg-rose-500', CLOSED: 'bg-slate-400',
  AI_INVESTIGATION: 'bg-violet-600', INCIDENT_RECORDED: 'bg-rose-600', MAINTENANCE_RECORDED: 'bg-amber-600',
}
export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative space-y-4 pl-5 before:absolute before:left-[5px] before:top-1 before:h-[calc(100%-0.5rem)] before:w-px before:bg-line">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={cx('absolute -left-5 top-1 size-[11px] rounded-full ring-4 ring-white', EVENT_TONE[e.event_type] ?? 'bg-slate-400')} />
          <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
            <span className="font-medium text-ink-900">{titleCase(e.event_type)}</span>
            {e.to_status && <span className="text-ink-500">→ {titleCase(e.to_status)}</span>}
          </div>
          {e.note && <div className="mt-0.5 text-[13px] leading-relaxed text-ink-700">{e.note}</div>}
          <div className="mt-0.5 text-[11px] text-ink-400">{fmtDate(e.created_at)}{e.actor ? ` · ${e.actor.full_name} (${e.actor.role})` : ''}</div>
        </li>
      ))}
    </ol>
  )
}

export function Collapsible({ title, children, defaultOpen = false, right }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-line bg-white">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] font-medium">
        <span>{title}</span><span className="flex items-center gap-2">{right}<span className={cx('text-ink-400 transition', open && 'rotate-90')}>›</span></span>
      </button>
      {open && <div className="border-t border-line px-3 py-3">{children}</div>}
    </div>
  )
}
