import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell'
import { EmptyState, Spinner } from './components/ui'
import { useAuth } from './lib/auth'
import { Login, Signup } from './pages/Auth'

const Overview = lazy(() => import('./pages/Overview'))
const Complaints = lazy(() => import('./pages/Complaints'))
const ComplaintDetail = lazy(() => import('./pages/ComplaintDetail'))
const MyComplaints = lazy(() => import('./pages/MyComplaints'))
const Tickets = lazy(() => import('./pages/Tickets'))
const TicketDetail = lazy(() => import('./pages/TicketDetail'))
const Operations = lazy(() => import('./pages/metro/Operations'))
const Risk = lazy(() => import('./pages/metro/Risk'))
const Incidents = lazy(() => import('./pages/metro/Incidents'))
const Maintenance = lazy(() => import('./pages/metro/Maintenance'))
const MetroAssets = lazy(() => import('./pages/metro/MetroAssets'))
const Stations = lazy(() => import('./pages/Stations'))
const StationDetail = lazy(() => import('./pages/StationDetail'))
const Assets = lazy(() => import('./pages/Assets'))
const AssetDetail = lazy(() => import('./pages/AssetDetail'))
const KnowledgeGraph = lazy(() => import('./pages/KnowledgeGraph'))
const Investigations = lazy(() => import('./pages/Investigations'))
const InvestigationDetail = lazy(() => import('./pages/InvestigationDetail'))
const ResolutionMemory = lazy(() => import('./pages/ResolutionMemory'))
const Documents = lazy(() => import('./pages/Documents'))
const Assistant = lazy(() => import('./pages/Assistant'))
const Datasets = lazy(() => import('./pages/Datasets'))
const Models = lazy(() => import('./pages/Models'))
const Analytics = lazy(() => import('./pages/Analytics'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const EngineerWork = lazy(() => import('./pages/EngineerWork'))
const ReviewQueue = lazy(() => import('./pages/ReviewQueue'))

function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return <div className="flex h-full items-center justify-center"><Spinner className="size-7" /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return <>{children}</>
}

function StaffOnly({ children }: { children: ReactNode }) {
  const { isStaff } = useAuth()
  if (!isStaff) return <EmptyState title="Staff access required" description="This workspace is available to operations staff. Passengers can raise complaints, track their tickets and use the document assistant." />
  return <>{children}</>
}

const page = (el: ReactNode, staff = false) => (
  <Suspense fallback={<div className="flex h-64 items-center justify-center"><Spinner /></div>}>{staff ? <StaffOnly>{el}</StaffOnly> : el}</Suspense>
)

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/app" element={<Protected><AppShell /></Protected>}>
        <Route index element={<Navigate to="/app/overview" replace />} />
        <Route path="overview" element={page(<Overview />)} />
        <Route path="complaints" element={page(<Complaints />, true)} />
        <Route path="complaints/:id" element={page(<ComplaintDetail />)} />
        <Route path="my-complaints" element={page(<MyComplaints />)} />
        <Route path="tickets" element={page(<Tickets />)} />
        <Route path="tickets/:id" element={page(<TicketDetail />)} />
        <Route path="work" element={page(<EngineerWork />, true)} />
        <Route path="review" element={page(<ReviewQueue />, true)} />
        <Route path="metro/operations" element={page(<Operations />, true)} />
        <Route path="metro/risk" element={page(<Risk />, true)} />
        <Route path="metro/incidents" element={page(<Incidents />, true)} />
        <Route path="metro/maintenance" element={page(<Maintenance />, true)} />
        <Route path="metro/assets" element={page(<MetroAssets />, true)} />
        <Route path="assets" element={page(<Assets />, true)} />
        <Route path="assets/:id" element={page(<AssetDetail />, true)} />
        <Route path="stations" element={page(<Stations />, true)} />
        <Route path="stations/:id" element={page(<StationDetail />, true)} />
        <Route path="knowledge-graph" element={page(<KnowledgeGraph />, true)} />
        <Route path="investigations" element={page(<Investigations />, true)} />
        <Route path="investigations/:id" element={page(<InvestigationDetail />, true)} />
        <Route path="resolution-memory" element={page(<ResolutionMemory />, true)} />
        <Route path="documents" element={page(<Documents />, true)} />
        <Route path="assistant" element={page(<Assistant />, true)} />
        <Route path="datasets" element={page(<Datasets />, true)} />
        <Route path="models" element={page(<Models />, true)} />
        <Route path="analytics" element={page(<Analytics />, true)} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="*" element={<EmptyState title="Page not found" description="This page does not exist in the workspace." />} />
      </Route>
      <Route path="*" element={<Navigate to="/app/overview" replace />} />
    </Routes>
  )
}
