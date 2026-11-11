import { useQuery } from '@tanstack/react-query'
import { localRequest } from '../lib/local-api'
import { legacyInformation } from '../lib/legacy-storage'

export function LocalStorageNotice() {
  const query = useQuery({
    queryKey: ['sqlite-storage-status'],
    queryFn: async () => ({
      status: await localRequest<{ business_empty: boolean }>('/local/status'),
      legacy: await legacyInformation(),
    }),
  })
  if (query.error)
    return (
      <div className="notice" role="alert">
        <p>No se pudo comprobar el almacenamiento local. {query.error.message}</p>
      </div>
    )
  if (!query.data) return null
  if (query.data.legacy === 'present')
    return (
      <div className="notice" role="status">
        <p>
          <strong>Migración pendiente.</strong> Hay información guardada en este navegador que
          todavía no está en SQLite. Los datos anteriores se conservan; su traslado se realizará en
          la fase 3.
          {query.data.status.business_empty ? ' La base SQLite aún no contiene operaciones.' : ''}
        </p>
      </div>
    )
  if (query.data.legacy === 'unknown')
    return (
      <div className="notice" role="status">
        <p>
          No se pudo comprobar si hay información anterior en este navegador. Conserva el mismo
          perfil y dirección; no borres sus datos. La migración histórica está pendiente.
        </p>
      </div>
    )
  return null
}
