import { KeyRound, ListChecks, Server, Shield, User as UserIcon, Users } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, KeyValue, LoadingBlock, PageHeader, Progress, Select, StatusBadge, Tabs, useToast } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { bytes, fmtDate, timeAgo, titleCase } from '../lib/format'
import { useApi, usePolling } from '../lib/hooks'

/* eslint-disable @typescript-eslint/no-explicit-any */
function Profile() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(user?.full_name ?? '')
  const [lang, setLang] = useState(user?.preferred_language ?? 'en')
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const save = async () => { try { await api('/api/auth/me', { method: 'PATCH', json: { full_name: name, preferred_language: lang } }); await refresh(); toast({ tone: 'success', message: 'Profile saved' }) } catch (e) { toast({ tone: 'error', message: (e as Error).message }) } }
  const change = async () => { try { await api('/api/auth/change-password', { method: 'POST', json: pw }); setPw({ current_password: '', new_password: '' }); toast({ tone: 'success', message: 'Password changed' }) } catch (e) { toast({ tone: 'error', message: (e as Error).message }) } }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card><CardHeader title="Profile" icon={<UserIcon className="size-4" />} />
        <div className="space-y-4"><Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email"><Input value={user?.email ?? ''} disabled /></Field>
          <Field label="Preferred language (complaint assistant)"><Select value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'ta')}><option value="en">English</option><option value="ta">தமிழ்</option></Select></Field>
          <div className="flex items-center justify-between"><div className="flex gap-1.5"><Badge tone="brand">{titleCase(user?.role)}</Badge>{user?.team && <Badge>{user.team}</Badge>}{user?.is_demo && <Badge tone="amber">Demo account</Badge>}</div><Button variant="primary" onClick={save}>Save</Button></div></div></Card>
      <Card><CardHeader title="Change password" icon={<KeyRound className="size-4" />} />
        <div className="space-y-4"><Field label="Current password"><Input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
          <Field label="New password" hint="Min. 8 characters"><Input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
          <div className="flex justify-end"><Button variant="primary" disabled={pw.new_password.length < 8 || !pw.current_password} onClick={change}>Update password</Button></div></div></Card>
    </div>
  )
}

function UsersAdmin() {
  const { user: me } = useAuth()
  const toast = useToast()
  const { data, error, loading, reload } = useApi<any>('/api/admin/users')
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <LoadingBlock />
  const patch = async (id: number, body: any) => { try { await api(`/api/admin/users/${id}`, { method: 'PATCH', json: body }); toast({ tone: 'success', message: 'User updated' }); reload(true) } catch (e) { toast({ tone: 'error', message: (e as Error).message }) } }
  return (
    <div className="space-y-6">
      <Card padded={false}><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-line bg-slate-50/60 text-xs text-ink-500"><tr><th className="px-4 py-2.5 text-left font-medium">User</th><th className="px-4 py-2.5 text-left font-medium">Role</th><th className="px-4 py-2.5 text-left font-medium">Team</th><th className="px-4 py-2.5 text-left font-medium">Last login</th><th className="px-4 py-2.5 text-left font-medium">Active</th></tr></thead>
        <tbody className="divide-y divide-line">{data.items.map((u: any) => (
          <tr key={u.id}><td className="px-4 py-2.5"><div className="font-medium">{u.full_name} {u.is_demo && <Badge tone="amber">demo</Badge>}</div><div className="text-xs text-ink-500">{u.email}</div></td>
            <td className="px-4 py-2.5"><Select className="h-8 w-36" value={u.role} disabled={u.id === me?.id} onChange={(e) => patch(u.id, { role: e.target.value })}>{data.roles.map((r: any) => <option key={r.name} value={r.name}>{titleCase(r.name)}</option>)}</Select></td>
            <td className="px-4 py-2.5"><Select className="h-8 w-52" value={u.team ?? ''} onChange={(e) => patch(u.id, { team: e.target.value })}><option value="">—</option>{data.teams.map((t: string) => <option key={t}>{t}</option>)}</Select></td>
            <td className="px-4 py-2.5 text-xs text-ink-500">{timeAgo(u.last_login_at)}</td>
            <td className="px-4 py-2.5"><input type="checkbox" checked={u.is_active} disabled={u.id === me?.id} onChange={(e) => patch(u.id, { is_active: e.target.checked })} /></td></tr>))}</tbody></table></div></Card>
      <Card><CardHeader title="Role permissions" icon={<Shield className="size-4" />} />
        <div className="grid gap-3 md:grid-cols-2">{data.roles.map((r: any) => <div key={r.name} className="rounded-lg border border-line p-3"><div className="font-semibold">{titleCase(r.name)}</div><div className="text-xs text-ink-500">{r.description}</div>
          <div className="mt-2 flex flex-wrap gap-1">{r.permissions.map((p: string) => <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]">{p}</span>)}</div></div>)}</div></Card>
    </div>
  )
}

function SystemAdmin() {
  const { data: sys } = useApi<any>('/api/system')
  const { data: jobs, reload } = useApi<any[]>('/api/jobs')
  const { data: audit } = useApi<any[]>('/api/admin/audit?limit=60')
  usePolling(() => reload(true), 5000)
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="System" icon={<Server className="size-4" />} />{!sys ? <LoadingBlock rows={3} /> : <KeyValue items={[['Database', <span className="font-mono text-[11px]">{sys.database_path}</span>], ['Database size', bytes(sys.database_bytes)], ['Python', sys.python], ['CPU cores', sys.cpu_count],
          ['Ingestion workers', sys.ingest_workers], ['Embedding batch', sys.embedding_batch_size], ['OCR', sys.ocr_enabled ? 'Enabled' : 'Disabled'], ['Email / SMS', sys.email_sms]]} />}</Card>
        <Card><CardHeader title="Table row counts" />{sys && <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">{Object.entries(sys.tables).map(([k, v]: any) => <div key={k} className="flex justify-between"><span className="font-mono text-xs text-ink-500">{k}</span><b className="tabular-nums">{v}</b></div>)}</div>}</Card>
      </div>
      <Card><CardHeader title="Background jobs" icon={<ListChecks className="size-4" />} />
        <ul className="divide-y divide-line">{jobs?.map((j) => (
          <li key={j.id} className="py-2.5 text-[13px]"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-ink-400">#{j.id}</span><span className="font-medium">{titleCase(j.type)}</span><StatusBadge status={j.status} /><span className="text-xs text-ink-500">{j.message}</span>
            <span className="ml-auto text-xs text-ink-400">{fmtDate(j.created_at)}</span>{['QUEUED', 'RUNNING'].includes(j.status) && <Button size="sm" variant="ghost" onClick={() => api(`/api/jobs/${j.id}/cancel`, { method: 'POST' }).then(() => reload(true))}>Cancel</Button>}</div>
            {j.status === 'RUNNING' && j.total > 0 && <Progress className="mt-1.5" value={j.progress} total={j.total} />}{j.error && <div className="mt-1 text-xs text-rose-600">{j.error}</div>}</li>))}</ul></Card>
      <Card><CardHeader title="Audit log" subtitle="Security-relevant actions" />
        <ul className="max-h-96 divide-y divide-line overflow-y-auto text-[12.5px] thin-scroll">{audit?.map((a) => <li key={a.id} className="flex flex-wrap gap-2 py-1.5"><span className="font-mono text-ink-500">{a.action}</span><span>{a.entity_type} {a.entity_id}</span><span className="text-ink-500">{a.actor?.full_name ?? 'system'}</span><span className="ml-auto text-ink-400">{fmtDate(a.created_at)}</span></li>)}</ul></Card>
    </div>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'profile' | 'users' | 'system'>('profile')
  const admin = user?.role === 'admin'
  return (
    <div>
      <PageHeader eyebrow="Administration" title="Settings" description={admin ? 'Profile, user and role management, background jobs, system status and the audit log.' : 'Your profile and security settings.'} />
      <div className="mb-6"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: <span className="flex items-center gap-1.5"><UserIcon className="size-3.5" />Profile</span> }, ...(admin ? [{ value: 'users' as const, label: <span className="flex items-center gap-1.5"><Users className="size-3.5" />Users & roles</span> }, { value: 'system' as const, label: <span className="flex items-center gap-1.5"><Server className="size-3.5" />System & audit</span> }] : [])]} /></div>
      {tab === 'profile' ? <Profile /> : tab === 'users' && admin ? <UsersAdmin /> : admin ? <SystemAdmin /> : null}
    </div>
  )
}
