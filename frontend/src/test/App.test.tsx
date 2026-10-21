import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect } from 'vitest'
import { AuthProvider } from '../features/auth/AuthProvider'
import { App } from '../app/App'

vi.mock('../lib/env', () => ({
  authConfigured: false,
  localWorkspace: false,
  env: {
    apiUrl: 'http://localhost:8000/api/v1',
    preview: true,
    supabaseUrl: '',
    supabaseKey: '',
    organizationId: '',
  },
}))

function open(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Límites de la primera etapa', () => {
  it('redirige una ruta privada sin sesión al acceso', async () => {
    open('/pedidos')
    expect(await screen.findByRole('heading', { name: 'Todo empieza aquí.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
  })

  it('la vista previa no pide datos privados ni presenta guardados ficticios', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    open('/vista-previa/clientes/nuevo')
    expect(await screen.findByRole('button', { name: /Guardar cliente/ })).toBeDisabled()
    expect(screen.getByLabelText(/Nombre del cliente/)).toBeEnabled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('papa muestra clasificaciones y pesaje; la vista previa conserva el guardado bloqueado', async () => {
    open('/vista-previa/pedidos/nuevo')
    fireEvent.change(await screen.findByLabelText('Producto'), { target: { value: 'potato' } })
    expect(screen.getByRole('heading', { name: 'Clasificación de papa' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Cantidad de hectáreas')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Guardar pedido/ })).toBeDisabled()
  })

  it('sincronización explica que aún no está disponible', async () => {
    open('/vista-previa/sincronizacion')
    expect(await screen.findByRole('button', { name: /Sincronizar · Próximamente/ })).toBeDisabled()
    expect(screen.getByText(/Puedes capturar sin conexión/)).toBeInTheDocument()
  })
})
