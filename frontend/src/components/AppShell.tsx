import {
  Activity, BarChart3, Bell, BookOpen, Boxes, Brain, Building2, ChevronDown, ChevronsLeft, ChevronsRight, CircleHelp, Database,
  FileSearch, FileText, Gauge, History, LayoutDashboard, LogOut, Menu, MessageSquarePlus, MessagesSquare, Network, Search,
  Settings, ShieldAlert, Siren, Ticket, User as UserIcon, Wrench, X, Cpu, Map as MapIcon, ClipboardList, HardHat, ClipboardCheck,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { timeAgo, titleCase } from '../lib/format'
import { useDebounced, usePolling } from '../lib/hooks'
import { BrandLockup, BrandMark } from './Brand'
import { ComplaintDrawer } from './ComplaintDrawer'
import { StationSidebar } from './StationSidebar'
import { cx, IconButton, Tooltip } from './ui'

interface NavItem { to: string; label: string; icon: ReactNode; staff?: boolean; passengerOnly?: boolean; end?: boolean; roles?: string[]; passengerLabel?: string }
interface NavGroup { label: string; items: NavItem[]; staff?: boolean }

const I = 'size-[18px]'
const NAV: NavGroup[] = [
  { label: 'Workspace', items: [
    { to: '/app/overview', label: 'Overview', icon: <LayoutDashboard className={I} /> },
    { to: '/app/my-complaints', label: 'My Complaints', icon: <ClipboardList className={I} /> },
    { to: '/app/complaints', label: 'Complaints', icon: <MessagesSquare className={I} />, staff: true },
    { to: '/app/tickets', label: 'Tickets', icon: <Ticket className={I} />, passengerLabel: 'My Tickets' },
    { to: '/app/work', label: 'My Work', icon: <HardHat className={I} />, roles: ['engineer', 'admin'] },
    { to: '/app/review', label: 'Review Queue', icon: <ClipboardCheck className={I} />, roles: ['supervisor', 'admin'] },
  ] },
  { label: 'Metro Operations', staff: true, items: [
    { to: '/app/metro/operations', label: 'Operations', icon: <Gauge className={I} /> },
    { to: '/app/metro/risk', label: 'Risk Intelligence', icon: <ShieldAlert className={I} /> },
    { to: '/app/metro/incidents', label: 'Incidents', icon: <Siren className={I} /> },
    { to: '/app/metro/maintenance', label: 'Maintenance', icon: <Wrench className={I} /> },
  ] },
  { label: 'Infrastructure', staff: true, items: [
    { to: '/app/stations', label: 'Stations', icon: <Building2 className={I} /> },
    { to: '/app/metro/assets', label: 'Network & Assets', icon: <MapIcon className={I} /> },
    { to: '/app/assets', label: 'Asset Registry', icon: <Boxes className={I} />, end: true },
  ] },
  { label: 'Intelligence', staff: true, items: [
    { to: '/app/assistant', label: 'Document Assistant', icon: <FileSearch className={I} /> },
    { to: '/app/knowledge-graph', label: 'Knowledge Graph', icon: <Network className={I} />, staff: true },
    { to: '/app/investigations', label: 'Investigations', icon: <Brain className={I} />, staff: true },
    { to: '/app/resolution-memory', label: 'Resolution Memory', icon: <History className={I} />, staff: true },
  ] },
  { label: 'Data & Models', staff: true, items: [
    { to: '/app/documents', label: 'Documents', icon: <FileText className={I} /> },
    { to: '/app/datasets', label: 'Datasets', icon: <Database className={I} /> },
    { to: '/app/models', label: 'AI Models', icon: <Cpu className={I} /> },
    { to: '/app/analytics', label: 'Analytics', icon: <BarChart3 className={I} />, staff: true },
  ] },
  { label: 'Administration', items: [
    { to: '/app/settings', label: 'Settings', icon: <Settings className={I} /> },
  ] },
]

const CRUMB: Record<string, string> = {
  app: 'Workspace', overview: 'Overview', complaints: 'Complaints', 'my-complaints': 'My Complaints', tickets: 'Tickets', metro: 'Metro',
  operations: 'Operations', risk: 'Risk Intelligence', incidents: 'Incidents', maintenance: 'Maintenance', assets: 'Assets',
  stations: 'Stations', 'knowledge-graph': 'Knowledge Graph', investigations: 'Investigations', 'resolution-memory': 'Resolution Memory',
  documents: 'Documents', datasets: 'Datasets', models: 'AI Models', analytics: 'Analytics', settings: 'Settings', assistant: 'Document Assistant', work: 'My Work', review: 'Review Queue',
}

function Breadcrumbs() {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length <= 2) return null
  const crumbs = parts.slice(1).map((p, i) => ({ label: CRUMB[p] ?? (/^\d+$/.test(p) ? `#${p}` : titleCase(p)), to: '/' + parts.slice(0, i + 2).join('/') }))
  return (
    <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-[13px] text-ink-500 lg:flex">
      {crumbs.map((c, i) => (
        <span key={c.to} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-ink-400">/</span>}
          {i < crumbs.length - 1 && c.label !== 'Metro' ? <Link to={c.to} className="hover:text-ink-900">{c.label}</Link> : <span className={i === crumbs.length - 1 ? 'font-medium text-ink-900' : ''}>{c.label}</span>}
        </span>
      ))}
    </nav>
  )
}

interface SearchResult { type: string; id: number; title: string; subtitle: string; link: string }
function GlobalSearch() {
  const { isStaff } = useAuth()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const dq = useDebounced(q, 250)
  const nav = useNavigate()
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus() } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => {
    if (dq.trim().length < 2) { setResults([]); return }
    setLoading(true)
    api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(dq)}`).then((r) => setResults(r.results)).catch(() => setResults([])).finally(() => setLoading(false))
  }, [dq])
  const icon = (t: string) => ({ station: <Building2 className="size-4" />, ticket: <Ticket className="size-4" />, document: <FileText className="size-4" />, asset: <Boxes className="size-4" />, investigation: <Brain className="size-4" /> }[t] ?? <Search className="size-4" />)
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
      <input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={isStaff ? "Search stations, tickets, documents, assets…" : "Search your tickets and complaints…"} aria-label="Global search"
        className="focus-ring h-9 w-full rounded-lg border border-line bg-slate-50 pl-9 pr-14 text-sm placeholder:text-ink-400 hover:bg-white focus:bg-white" />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-white px-1.5 text-[10px] font-medium text-ink-500 sm:block">Ctrl K</kbd>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-line bg-white shadow-pop">
          {loading && <div className="px-4 py-3 text-sm text-ink-500">Searching…</div>}
          {!loading && results.length === 0 && <div className="px-4 py-3 text-sm text-ink-500">No matches for “{q}”.</div>}
          {results.map((r) => (
            <button key={`${r.type}-${r.id}`} onMouseDown={() => { nav(r.link); setOpen(false); setQ('') }} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
              <span className="mt-0.5 text-ink-400">{icon(r.type)}</span>
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.title}</span><span className="block truncate text-xs text-ink-500">{titleCase(r.type)} · {r.subtitle}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Notif { id: number; type: string; title: string; body: string; link: string | null; is_read: boolean; created_at: string }
function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ unread: number; items: Notif[] }>({ unread: 0, items: [] })
  const nav = useNavigate()
  const load = () => api<{ unread: number; items: Notif[] }>('/api/notifications').then(setData).catch(() => {})
  useEffect(() => { load() }, [])
  usePolling(load, 20000)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const openItem = async (n: Notif) => {
    if (!n.is_read) await api(`/api/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {})
    setOpen(false); load()
    if (n.link) nav(n.link)
  }
  return (
    <div className="relative" ref={ref}>
      <IconButton label="Notifications" onClick={() => { setOpen(!open); if (!open) load() }}>
        <Bell className="size-[18px]" />
        {data.unread > 0 && <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-white">{data.unread > 9 ? '9+' : data.unread}</span>}
      </IconButton>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-50 mt-2 w-[22rem] overflow-hidden rounded-xl border border-line bg-white shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-semibold">Notifications</div>
              {data.unread > 0 && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={async () => { await api('/api/notifications/read-all', { method: 'POST' }); load() }}>Mark all read</button>}
            </div>
            <div className="max-h-96 overflow-y-auto thin-scroll">
              {data.items.length === 0 && <div className="px-4 py-8 text-center text-sm text-ink-500">You're all caught up.</div>}
              {data.items.map((n) => (
                <button key={n.id} onClick={() => openItem(n)} className={cx('flex w-full gap-3 border-b border-line/70 px-4 py-3 text-left hover:bg-slate-50', !n.is_read && 'bg-brand-50/40')}>
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-brand-500')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink-900">{n.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-500 line-clamp-2">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-ink-400">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="border-t border-line bg-slate-50/60 px-4 py-2 text-[11px] text-ink-500">In-app notifications only — email/SMS delivery is not configured.</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  if (!user) return null
  const initials = user.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="focus-ring flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-900 text-xs font-semibold text-white">{initials}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[10rem] truncate text-[13px] font-medium">{user.full_name}</span>
          <span className="block text-[11px] text-ink-500">{titleCase(user.role)}{user.team ? ` · ${user.team}` : ''}</span>
        </span>
        <ChevronDown className="hidden size-4 text-ink-400 md:block" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-pop">
          <div className="border-b border-line px-4 py-3"><div className="text-sm font-medium">{user.full_name}</div><div className="truncate text-xs text-ink-500">{user.email}</div></div>
          <button onClick={() => { setOpen(false); nav('/app/settings') }} className="flex w-full items-center gap-2.5 px-4 py-2 text-sm hover:bg-slate-50"><UserIcon className="size-4 text-ink-400" />Profile & settings</button>
          <button onClick={() => { logout(); nav('/login') }} className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"><LogOut className="size-4" />Sign out</button>
        </div>
      )}
    </div>
  )
}

function HelpMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="relative hidden sm:block" ref={ref}>
      <IconButton label="Help & provenance guide" onClick={() => setOpen(!open)}><CircleHelp className="size-[18px]" /></IconButton>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-line bg-white p-4 text-[13px] shadow-pop">
          <div className="mb-2 flex items-center gap-2 font-semibold"><BookOpen className="size-4 text-brand-600" />How to read MegaAsset</div>
          <ul className="space-y-1.5 text-ink-700">
            <li><b>DOCUMENTED</b> — stated in a source document or dataset.</li>
            <li><b>REPORTED</b> — from a passenger complaint; unverified.</li>
            <li><b>PROCESSED</b> — calculated from documented data.</li>
            <li><b>AI_HYPOTHESIS</b> — inferred by the agent; needs review.</li>
            <li><b>POTENTIAL</b> — possible risk, not confirmed.</li>
            <li><b>VERIFIED</b> — confirmed by a human step.</li>
          </ul>
          <div className="mt-3 border-t border-line pt-3 text-xs text-ink-500">Shortcuts: <kbd className="rounded border px-1">Ctrl K</kbd> search. Independent project using public CMRL data; not an official CMRL system.</div>
        </div>
      )}
    </div>
  )
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { isStaff, user } = useAuth()
  const role = user?.role ?? ''
  const groups = useMemo(() => NAV.filter((g) => !g.staff || isStaff).map((g) => ({ ...g, items: g.items.filter((i) => (!i.staff || isStaff) && (!i.roles || i.roles.includes(role))) })).filter((g) => g.items.length), [isStaff, role])
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3 thin-scroll" aria-label="Main navigation">
      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          {!collapsed ? <div className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-slate-400">{g.label}</div> : <div className="mx-auto mb-2 h-px w-6 bg-white/10" />}
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const link = (
                <NavLink to={it.to} end={it.end} onClick={onNavigate}
                  className={({ isActive }) => cx('group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-white/10 text-white shadow-[inset_2px_0_0_0_#38bdf8]' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                  <span className="shrink-0">{it.icon}</span>
                  {!collapsed && <span className="truncate">{!isStaff && it.passengerLabel ? it.passengerLabel : it.label}</span>}
                </NavLink>
              )
              return <li key={it.to}>{collapsed ? <Tooltip label={it.label} side="right">{link}</Tooltip> : link}</li>
            })}
          </ul>
          {g.label === 'Infrastructure' && isStaff && <StationSidebar collapsed={collapsed} onNavigate={onNavigate} />}
        </div>
      ))}
    </nav>
  )
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('megaasset.sidebar') === '1' } catch { return false } })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [complaintOpen, setComplaintOpen] = useState(false)
  const { user } = useAuth()
  const loc = useLocation()
  useEffect(() => { try { localStorage.setItem('megaasset.sidebar', collapsed ? '1' : '0') } catch { /* ignore */ } }, [collapsed])
  useEffect(() => { setMobileOpen(false) }, [loc.pathname])
  useEffect(() => {
    const h = () => setComplaintOpen(true)
    window.addEventListener('megaasset:raise-complaint', h)
    return () => window.removeEventListener('megaasset:raise-complaint', h)
  }, [])

  const sidebar = (isMobile: boolean) => (
    <div className="sidebar-bg flex h-full flex-col text-white">
      <div className={cx('flex h-16 items-center border-b border-white/10', collapsed && !isMobile ? 'justify-center px-2' : 'justify-between px-4')}>
        <Link to="/app/overview">{collapsed && !isMobile ? <BrandMark /> : <BrandLockup inverse />}</Link>
        {isMobile && <button aria-label="Close menu" onClick={() => setMobileOpen(false)} className="rounded-md p-1.5 text-slate-300 hover:bg-white/10"><X className="size-5" /></button>}
      </div>
      <div className={cx('px-3 pt-4', collapsed && !isMobile && 'px-2')}>
        <button onClick={() => setComplaintOpen(true)}
          className={cx('focus-ring flex w-full items-center justify-center gap-2 rounded-lg bg-sky-400 font-semibold text-brand-950 shadow-sm transition hover:bg-sky-300', collapsed && !isMobile ? 'h-10' : 'h-10 text-sm')}>
          <MessageSquarePlus className="size-[18px]" />{(!collapsed || isMobile) && 'Raise a Complaint'}
        </button>
      </div>
      <SidebarNav collapsed={collapsed && !isMobile} onNavigate={isMobile ? () => setMobileOpen(false) : undefined} />
      {!isMobile && (
        <div className="border-t border-white/10 p-3">
          <button onClick={() => setCollapsed(!collapsed)} className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-white">
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" />Collapse</>}
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className={cx('hidden shrink-0 transition-[width] duration-200 lg:block', collapsed ? 'w-[72px]' : 'w-64')}>{sidebar(false)}</aside>
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-ink-900/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside className="absolute left-0 top-0 h-full w-72" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', damping: 30, stiffness: 300 }}>{sidebar(true)}</motion.aside>
          </div>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="topbar sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 px-4 backdrop-blur md:px-6">
          <button aria-label="Open menu" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-ink-500 hover:bg-slate-100 lg:hidden"><Menu className="size-5" /></button>
          <div className="flex min-w-0 flex-1 items-center gap-5">
            <GlobalSearch />
            <Breadcrumbs />
          </div>
          <div className="flex items-center gap-1">
            {user?.role !== 'passenger' && <QuickStatus />}
            <HelpMenu />
            <NotificationCenter />
            <div className="mx-1 h-6 w-px bg-line" />
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto thin-scroll">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8"><Outlet /></div>
        </main>
      </div>
      <ComplaintDrawer open={complaintOpen} onClose={() => setComplaintOpen(false)} />
    </div>
  )
}

function QuickStatus() {
  const [job, setJob] = useState<{ type: string; progress: number; total: number; message: string } | null>(null)
  const load = () => api<{ active_job: typeof job }>('/api/documents/stats').then((s) => setJob(s.active_job)).catch(() => {})
  useEffect(() => { load() }, [])
  usePolling(load, 8000)
  if (!job) return null
  return (
    <Link to="/app/documents" className="mr-1 hidden items-center gap-2 rounded-lg border border-brand-100 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800 xl:flex">
      <Activity className="size-3.5 animate-pulse" />
      {titleCase(job.type)} {job.total ? `${job.progress}/${job.total}` : ''}
    </Link>
  )
}

