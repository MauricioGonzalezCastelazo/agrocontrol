export function QueryState({
  loading,
  error,
  retry,
}: {
  loading?: boolean
  error?: unknown
  retry?: () => void
}) {
  if (loading)
    return (
      <p className="data-message" role="status">
        Cargando información…
      </p>
    )
  if (error)
    return (
      <div className="data-message" role="alert">
        <p>{error instanceof Error ? error.message : 'No pudimos cargar la información.'}</p>
        {retry && (
          <button className="button button-secondary" onClick={retry}>
            Volver a intentar
          </button>
        )}
      </div>
    )
  return null
}
