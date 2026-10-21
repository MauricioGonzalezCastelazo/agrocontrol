import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Map } from 'lucide-react'
import { Layout } from './Layout'
import { useAuth } from '../features/auth/AuthProvider'
import { ActionLink, EmptyState, LoadingState } from '../components/ui'
import { env, localWorkspace } from '../lib/env'
import { useBase } from './useBase'
import { SyncPage } from '../features/sync/SyncPage'
import { AccountsPage, CustomerAccountPage } from '../features/payments/AccountPages'
import { PaymentFormPage, PendingPaymentPage } from '../features/payments/PaymentFormPage'
import { PaymentDetailPage } from '../features/payments/PaymentDetailPage'

const LoginPage = lazy(() =>
  import('../features/auth/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const HomePage = lazy(() =>
  import('../features/home/HomePage').then((m) => ({ default: m.HomePage })),
)
const CustomersPage = lazy(() =>
  import('../features/customers/CustomerPages').then((m) => ({ default: m.CustomersPage })),
)
const CustomerFormPage = lazy(() =>
  import('../features/customers/CustomerPages').then((m) => ({ default: m.CustomerFormPage })),
)
const OrdersPage = lazy(() =>
  import('../features/orders/OrderPages').then((m) => ({ default: m.OrdersPage })),
)
const OrderFormPage = lazy(() =>
  import('../features/orders/OrderPages').then((m) => ({ default: m.OrderFormPage })),
)
const OrderDetailPage = lazy(() =>
  import('../features/orders/OrderPages').then((m) => ({ default: m.OrderDetailPage })),
)
const EditOrderFormPage = lazy(() =>
  import('../features/orders/OrderPages').then((m) => ({ default: m.EditOrderFormPage })),
)
const PendingOrderFormPage = lazy(() =>
  import('../features/orders/OrderPages').then((m) => ({ default: m.PendingOrderFormPage })),
)
const SettingsPage = lazy(() =>
  import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)

function RequireSession() {
  return useAuth().principal ? <Outlet /> : <Navigate to="/login" replace />
}
function OpenLocalWorkspace() {
  const location = useLocation()
  const path = location.pathname.replace(/^\/vista-previa/, '') || '/'
  return <Navigate to={`${path}${location.search}${location.hash}`} replace />
}
function NotFound() {
  return (
    <EmptyState
      icon={Map}
      title="Este camino aún no existe"
      description="Vuelve a tu espacio de trabajo para continuar."
      action={<ActionLink to={useBase() || '/'}>Volver al inicio</ActionLink>}
    />
  )
}
function workspaceRoutes() {
  return (
    <>
      <Route index element={<HomePage />} />
      <Route path="clientes" element={<CustomersPage />} />
      <Route path="clientes/nuevo" element={<CustomerFormPage />} />
      <Route path="clientes/:id/editar" element={<CustomerFormPage editing />} />
      <Route path="pedidos" element={<OrdersPage />} />
      <Route path="pedidos/nuevo" element={<OrderFormPage />} />
      <Route path="pedidos/:id" element={<OrderDetailPage />} />
      <Route path="pedidos/:id/editar" element={<EditOrderFormPage />} />
      <Route path="borradores/:id" element={<PendingOrderFormPage />} />
      <Route path="cobros" element={<AccountsPage />} />
      <Route path="cobros/clientes/:id" element={<CustomerAccountPage />} />
      <Route path="cobros/nuevo" element={<PaymentFormPage />} />
      <Route path="cobros/pendientes/:id" element={<PendingPaymentPage />} />
      <Route path="cobros/:id" element={<PaymentDetailPage />} />
      <Route path="cobros/:id/aplicar" element={<PaymentFormPage credit />} />
      <Route path="sincronizacion" element={<SyncPage />} />
      <Route path="configuracion" element={<SettingsPage />} />
      <Route path="*" element={<NotFound />} />
    </>
  )
}

export function App() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireSession />}>
          <Route path="/" element={<Layout />}>
            {workspaceRoutes()}
          </Route>
        </Route>
        {localWorkspace && <Route path="/vista-previa/*" element={<OpenLocalWorkspace />} />}
        {env.preview && !localWorkspace && (
          <Route path="/vista-previa" element={<Layout preview />}>
            {workspaceRoutes()}
          </Route>
        )}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  )
}
