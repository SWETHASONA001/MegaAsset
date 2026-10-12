import { ArrowRight, FileSearch, Lock, Mail, Network, ShieldCheck, User as UserIcon } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BrandLockup } from '../components/Brand'
import { Button, Field, Input, Select } from '../components/ui'
import { useAuth } from '../lib/auth'

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-brand-950 lg:block">
        <svg className="absolute inset-0 h-full w-full opacity-[0.18]" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#38bdf8" strokeWidth="0.5" /></pattern></defs>
          <rect width="600" height="800" fill="url(#g)" />
          <path d="M60 720 C 160 600, 200 520, 300 420 S 470 220, 560 80" fill="none" stroke="#3b82f6" strokeWidth="6" strokeLinecap="round" />
          <path d="M40 300 C 180 330, 260 400, 300 420 S 420 560, 580 600" fill="none" stroke="#22c55e" strokeWidth="6" strokeLinecap="round" />
          {[[60, 720], [180, 590], [300, 420], [430, 260], [560, 80], [40, 300], [170, 335], [420, 540], [580, 600]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="9" fill="#0b3b5c" stroke="#fff" strokeWidth="3" />
          ))}
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <BrandLockup inverse />
          <div className="max-w-md">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight">Evidence-grounded intelligence for metro infrastructure.</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-slate-300">Passenger complaints, operational tickets, CMRL documents and transit data — connected through a knowledge graph and investigated by an agentic workflow that always shows its sources.</p>
            <ul className="mt-8 space-y-4 text-sm text-slate-200">
              <li className="flex gap-3"><FileSearch className="size-5 shrink-0 text-sky-300" />Ask questions across the indexed document collection with page-level citations.</li>
              <li className="flex gap-3"><Network className="size-5 shrink-0 text-sky-300" />Trace every relationship back to the document, dataset row or record it came from.</li>
              <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-sky-300" />AI proposals stay hypotheses until a human approves and a passenger verifies.</li>
            </ul>
          </div>
          <p className="text-xs text-slate-400">Independent project built on publicly available CMRL documents and transit data. Not an official Chennai Metro Rail Limited system.</p>
        </div>
      </div>
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><BrandLockup /></div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  )
}

function IconInput({ icon, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">{icon}</span>
      <Input {...rest} className="h-10 pl-9" />
    </div>
  )
}

export function Login() {
  const { login, user } = useAuth()
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  if (user) return <Navigate to={loc.state?.from ?? '/app/overview'} replace />
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setLoading(true)
    try { await login(email, password); nav(loc.state?.from ?? '/app/overview', { replace: true }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Login failed') }
    finally { setLoading(false) }
  }
  const demo = (e: string, p: string) => { setEmail(e); setPassword(p) }
  return (
    <AuthLayout title="Sign in" subtitle="Access the MegaAsset operations workspace.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><IconInput icon={<Mail className="size-4" />} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
        <Field label="Password"><IconInput icon={<Lock className="size-4" />} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></Field>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>Sign in <ArrowRight className="size-4" /></Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-500">New passenger? <Link to="/signup" className="font-medium text-brand-700 hover:underline">Create an account</Link></p>
      {import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true' && <div className="mt-8 rounded-xl border border-line bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Demo staff accounts</div>
        <p className="mt-1 text-xs text-ink-500">Created locally at first start for demonstration. Change passwords in production.</p>
        <div className="mt-3 grid gap-1.5">
          {[['Administrator / supervisor', 'admin@megaasset.local', 'ChangeMe!2026'], ['Control-room operator', 'operator@megaasset.local', 'Operator!2026'], ['E&M engineer', 'engineer@megaasset.local', 'Engineer!2026']].map(([r, e, p]) => (
            <button key={e} type="button" onClick={() => demo(e, p)} className="flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-left text-xs hover:border-brand-300">
              <span><span className="block font-medium text-ink-900">{r}</span><span className="text-ink-500">{e}</span></span>
              <span className="text-brand-700">Use</span>
            </button>
          ))}
        </div>
      </div>}
    </AuthLayout>
  )
}

export function Signup() {
  const { signup, user } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', password: '', preferred_language: 'en' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  if (user) return <Navigate to="/app/overview" replace />
  const valid = form.full_name.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email) && form.password.length >= 8 && /\d/.test(form.password) && /[A-Za-z]/.test(form.password)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setLoading(true)
    try { await signup(form); nav('/app/overview', { replace: true }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign-up failed') }
    finally { setLoading(false) }
  }
  return (
    <AuthLayout title="Create a passenger account" subtitle="Raise complaints, track tickets and confirm resolutions.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name"><IconInput icon={<UserIcon className="size-4" />} required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
        <Field label="Email"><IconInput icon={<Mail className="size-4" />} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Password" hint="At least 8 characters, with letters and numbers."><IconInput icon={<Lock className="size-4" />} type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Field label="Preferred language">
          <Select value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value })} className="h-10">
            <option value="en">English</option><option value="ta">தமிழ் (Tamil)</option>
          </Select>
        </Field>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} disabled={!valid}>Create account <ArrowRight className="size-4" /></Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-500">Already registered? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></p>
    </AuthLayout>
  )
}
