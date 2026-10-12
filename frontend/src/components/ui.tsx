import { clsx } from 'clsx'
import { AlertTriangle, ChevronLeft, ChevronRight, Info, Inbox, Loader2, RefreshCw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { titleCase } from '../lib/format'

export const cx = clsx

/* ---------------- Buttons ---------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-brand-700 to-teal-600 text-white hover:from-brand-800 hover:to-teal-700 shadow-sm shadow-brand-900/10 disabled:opacity-60',
  secondary: 'bg-white text-ink-900 border border-line hover:bg-slate-50 hover:border-slate-300 shadow-sm',
  ghost: 'text-ink-700 hover:bg-slate-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
  subtle: 'bg-brand-50 text-brand-800 hover:bg-brand-100 border border-brand-100',
}
export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button {...rest} disabled={rest.disabled || loading}
      className={cx('focus-ring inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : size === 'lg' ? 'h-11 px-5 text-[15px]' : 'h-9 px-3.5 text-sm', variants[variant], className)}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tooltip label={label}>
      <button aria-label={label} {...rest} className={cx('focus-ring inline-flex size-9 items-center justify-center rounded-lg text-ink-500 hover:bg-slate-100 hover:text-ink-900 transition-colors', className)}>
        {children}
      </button>
    </Tooltip>
  )
}

/* ---------------- Tooltip ---------------- */
export function Tooltip({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'bottom' | 'right' | 'top' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span role="tooltip" className={cx('pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-pop transition-opacity delay-150 group-hover/tt:opacity-100',
        side === 'bottom' && 'left-1/2 top-full mt-1.5 -translate-x-1/2', side === 'top' && 'left-1/2 bottom-full mb-1.5 -translate-x-1/2',
        side === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2')}>{label}</span>
    </span>
  )
}

/* ---------------- Card / layout ---------------- */
export function Card({ className, children, padded = true }: { className?: string; children: ReactNode; padded?: boolean }) {
  return <div className={cx('card-accent rounded-xl border border-sky-100 bg-white shadow-card', padded && 'p-5', className)}>{children}</div>
}
export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        {icon ? <span className="mt-0.5 rounded-md bg-gradient-to-br from-sky-100 to-teal-100 p-1 text-brand-700">{icon}</span>
          : <span className="mt-1 h-4 w-1 shrink-0 rounded-full bg-gradient-to-b from-sky-500 via-teal-500 to-emerald-400" />}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-brand-950">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ title, description, actions, eyebrow, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="page-hero relative mb-6 overflow-hidden rounded-2xl border border-brand-200/70 px-5 py-5 shadow-card md:px-7 md:py-6">
      <svg className="pointer-events-none absolute -right-10 -top-16 h-56 w-80 opacity-60" viewBox="0 0 320 220" aria-hidden>
        <circle cx="230" cy="80" r="90" fill="url(#ph1)" /><circle cx="110" cy="170" r="60" fill="url(#ph2)" />
        <path d="M10 200 C 90 150, 150 120, 210 60 S 300 10, 320 0" fill="none" stroke="#0c709a" strokeOpacity="0.25" strokeWidth="5" strokeLinecap="round" />
        <path d="M0 120 C 80 130, 150 150, 210 60" fill="none" stroke="#0d9488" strokeOpacity="0.25" strokeWidth="5" strokeLinecap="round" />
        <defs>
          <radialGradient id="ph1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" /><stop offset="100%" stopColor="#38bdf8" stopOpacity="0" /></radialGradient>
          <radialGradient id="ph2"><stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.4" /><stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" /></radialGradient>
        </defs>
      </svg>
      <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-700 ring-1 ring-brand-200">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold tracking-tight text-brand-950">{title}</h1>
          {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-700">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

type StatTone = 'default' | 'warn' | 'good' | 'brand' | 'violet' | 'teal' | 'indigo' | 'rose' | 'sky'
const STAT_TONES: Record<Exclude<StatTone, 'default'>, { bar: string; bg: string; chip: string; ring: string }> = {
  brand: { bar: 'from-brand-500 to-sky-400', bg: 'from-white to-sky-100', chip: 'bg-gradient-to-br from-brand-600 to-sky-500 text-white shadow-sm', ring: 'hover:border-sky-300' },
  sky: { bar: 'from-sky-500 to-cyan-400', bg: 'from-white to-cyan-100', chip: 'bg-gradient-to-br from-sky-500 to-cyan-500 text-white shadow-sm', ring: 'hover:border-cyan-300' },
  teal: { bar: 'from-teal-500 to-emerald-400', bg: 'from-white to-teal-100', chip: 'bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow-sm', ring: 'hover:border-teal-300' },
  good: { bar: 'from-emerald-500 to-lime-400', bg: 'from-white to-emerald-100', chip: 'bg-gradient-to-br from-emerald-500 to-lime-500 text-white shadow-sm', ring: 'hover:border-emerald-300' },
  warn: { bar: 'from-amber-500 to-orange-400', bg: 'from-white to-amber-100', chip: 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm', ring: 'hover:border-amber-300' },
  violet: { bar: 'from-violet-500 to-fuchsia-400', bg: 'from-white to-violet-100', chip: 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm', ring: 'hover:border-violet-300' },
  indigo: { bar: 'from-indigo-500 to-blue-400', bg: 'from-white to-indigo-100', chip: 'bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow-sm', ring: 'hover:border-indigo-300' },
  rose: { bar: 'from-rose-500 to-pink-400', bg: 'from-white to-rose-100', chip: 'bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow-sm', ring: 'hover:border-rose-300' },
}
const AUTO_TONES: Exclude<StatTone, 'default'>[] = ['brand', 'teal', 'violet', 'indigo', 'sky']

export function Stat({ label, value, hint, icon, tone = 'default', to }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: StatTone; to?: string }) {
  // 'default' picks a stable accent from the label so dashboards get varied, consistent colour without manual choices
  const key = tone === 'default' ? AUTO_TONES[[...label].reduce((a, c) => a + c.charCodeAt(0), 0) % AUTO_TONES.length] : tone
  const t = STAT_TONES[key]
  const body = (
    <div className={cx('relative overflow-hidden rounded-xl border border-line bg-gradient-to-br p-4 shadow-card transition', t.bg, to && cx('hover:shadow-pop', t.ring))}>
      <span className={cx('absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r', t.bar)} />
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-700">{label}</span>
        {icon && <span className={cx('rounded-xl p-2', t.chip)}>{icon}</span>}
      </div>
      <div className="mt-2 text-[26px] font-semibold tracking-tight text-ink-900 tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </div>
  )
  return to ? <Link to={to} className="focus-ring block rounded-xl">{body}</Link> : body
}

/* ---------------- Badges ---------------- */
const tones: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
}
export function Badge({ tone = 'gray', children, className, dot }: { tone?: keyof typeof tones | string; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap', tones[tone] ?? tones.gray, className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}{children}
    </span>
  )
}

const STATUS_TONE: Record<string, string> = {
  RECEIVED: 'blue', INVESTIGATING: 'violet', ASSIGNED: 'indigo', IN_PROGRESS: 'amber', PENDING_REVIEW: 'amber', AWAITING_VERIFICATION: 'teal', SUBMITTED: 'amber',
  RESOLVED: 'green', CLOSED: 'gray', REOPENED: 'red',
  INDEXED: 'green', PARTIAL: 'amber', FAILED: 'red', PENDING: 'gray', PROCESSING: 'blue', DUPLICATE: 'violet', MISSING: 'red',
  QUEUED: 'gray', RUNNING: 'blue', COMPLETED: 'green', CANCELLED: 'gray', PROCESSED: 'green',
  PROPOSED: 'amber', APPROVED: 'green', REJECTED: 'red', IMPLEMENTED: 'teal', AWAITING_APPROVAL: 'amber',
}
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'gray'} dot>{titleCase(status)}</Badge>
}
const PRI_TONE: Record<string, string> = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', CRITICAL: 'red', REQUIRES_REVIEW: 'violet' }
export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRI_TONE[priority] ?? 'gray'}>{titleCase(priority)}</Badge>
}

const PROV: Record<string, { tone: string; tip: string }> = {
  DOCUMENTED: { tone: 'brand', tip: 'Stated in a source document or published dataset' },
  REPORTED: { tone: 'blue', tip: 'Reported by a passenger — not verified' },
  PROCESSED: { tone: 'teal', tip: 'Deterministic calculation over documented data' },
  MODEL_PREDICTED: { tone: 'indigo', tip: 'Output of a trained model' },
  AI_HYPOTHESIS: { tone: 'violet', tip: 'Inference by the agentic pipeline — requires human review' },
  POTENTIAL: { tone: 'amber', tip: 'Possible issue or risk — unconfirmed' },
  SIMULATION: { tone: 'gray', tip: 'Simulated value' },
  VERIFIED: { tone: 'green', tip: 'Confirmed by a human verification step' },
  PENDING: { tone: 'gray', tip: 'Awaiting processing or review' },
  INSUFFICIENT_EVIDENCE: { tone: 'red', tip: 'Evidence does not support a conclusion' },
  REQUIRES_REVIEW: { tone: 'amber', tip: 'Needs human review before use' },
}
export function ProvenanceBadge({ label }: { label?: string | null }) {
  if (!label) return null
  const p = PROV[label] ?? { tone: 'gray', tip: label }
  return <Tooltip label={p.tip} side="top"><Badge tone={p.tone} className="font-mono tracking-tight !text-[10px]">{label}</Badge></Tooltip>
}

/* ---------------- States ---------------- */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-brand-600', className)} />
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-md', className)} />
}
export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
}
export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white/60 px-6 py-12 text-center', className)}>
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-ink-400">{icon ?? <Inbox className="size-6" />}</div>
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-ink-500 leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1"><div className="font-semibold">Something went wrong</div><div className="mt-0.5">{message}</div></div>
      {onRetry && <Button size="sm" onClick={onRetry} icon={<RefreshCw className="size-3.5" />}>Retry</Button>}
    </div>
  )
}
export function Notice({ children, tone = 'info', title }: { children: ReactNode; tone?: 'info' | 'warn'; title?: string }) {
  return (
    <div className={cx('flex gap-2.5 rounded-lg border p-3 text-[13px] leading-relaxed', tone === 'warn' ? 'border-amber-200 bg-amber-50/70 text-amber-900' : 'border-brand-100 bg-brand-50/60 text-brand-900')}>
      {tone === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
      <div>{title && <div className="font-semibold">{title}</div>}{children}</div>
    </div>
  )
}

/* ---------------- Form controls ---------------- */
export function Field({ label, hint, error, children, required }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-700">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-500">{hint}</span> : null}
    </label>
  )
}
const inputCls = 'focus-ring w-full rounded-lg border border-line bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 shadow-sm transition hover:border-slate-300 focus:border-brand-400'
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, 'h-9', props.className)} />
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'py-2 leading-relaxed', props.className)} />
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx(inputCls, 'h-9 pr-8 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 20 20%27 fill=%27%2364748b%27%3E%3Cpath d=%27M5.5 7.5l4.5 4.5 4.5-4.5%27 stroke=%27%2364748b%27 stroke-width=%271.5%27 fill=%27none%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat', className)}>{children}</select>
}

/* ---------------- Tabs ---------------- */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line thin-scroll">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cx('focus-ring relative -mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
            value === t.value ? 'border-teal-500 text-brand-800' : 'border-transparent text-ink-500 hover:text-ink-900')}>
          {t.label}
          {t.count !== undefined && <span className={cx('rounded-full px-1.5 text-[11px]', value === t.value ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-ink-500')}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ---------------- Overlays ---------------- */
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose)
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div role="dialog" aria-modal className={cx('relative w-full rounded-2xl bg-white shadow-pop', width)}
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: 0.18 }}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold">{title}</h2>
              <IconButton label="Close" onClick={onClose}><X className="size-4" /></IconButton>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4 thin-scroll">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line bg-slate-50/60 px-5 py-3 rounded-b-2xl">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>, document.body)
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose)
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[55]">
          <motion.div className="absolute inset-0 bg-ink-900/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside role="dialog" aria-modal className={cx('absolute right-0 top-0 flex h-full w-full flex-col bg-white shadow-pop', width)}
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}>
            <div className="flex items-start justify-between border-b border-line px-5 py-4">
              <div><h2 className="text-base font-semibold">{title}</h2>{subtitle && <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p>}</div>
              <IconButton label="Close" onClick={onClose}><X className="size-4" /></IconButton>
            </div>
            <div className="flex-1 overflow-y-auto thin-scroll">{children}</div>
            {footer && <div className="border-t border-line bg-slate-50/60 px-5 py-3">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>, document.body)
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onClose, loading, children }:
  { open: boolean; title: string; message: ReactNode; confirmLabel?: string; tone?: 'primary' | 'danger'; onConfirm: () => void; onClose: () => void; loading?: boolean; children?: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={tone} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <div className="text-sm text-ink-700 leading-relaxed">{message}</div>
      {children && <div className="mt-4">{children}</div>}
    </Modal>
  )
}

/* ---------------- Pagination ---------------- */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-3 text-[13px] text-ink-500">
      <span>{total === 0 ? 'No results' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="size-4" />}>Prev</Button>
        <span className="px-2 tabular-nums">{page} / {pages}</span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next <ChevronRight className="size-4" /></Button>
      </div>
    </div>
  )
}

/* ---------------- Toasts ---------------- */
interface Toast { id: number; tone: 'success' | 'error' | 'info'; message: string }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { ...t, id }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}
              className={cx('pointer-events-auto rounded-lg border px-3.5 py-2.5 text-sm shadow-pop bg-white',
                t.tone === 'success' ? 'border-emerald-200' : t.tone === 'error' ? 'border-rose-200' : 'border-line')}>
              <div className="flex items-start gap-2">
                <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', t.tone === 'success' ? 'bg-emerald-500' : t.tone === 'error' ? 'bg-rose-500' : 'bg-brand-500')} />
                <span className="text-ink-700">{t.message}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

/* ---------------- Misc ---------------- */
export function KeyValue({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: number }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3 text-sm', cols === 3 ? 'sm:grid-cols-3' : cols === 1 ? '' : 'sm:grid-cols-2')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-ink-500">{k}</dt>
          <dd className="mt-0.5 text-ink-900 break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Progress({ value, total, className }: { value: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <motion.div className="h-full rounded-full bg-brand-500" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="mb-3 mt-1 flex items-center justify-between"><h4 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{children}</h4>{action}</div>
}
