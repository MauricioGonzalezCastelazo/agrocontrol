import { useEffect } from 'react'

export function useUnsavedCapture(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const beforeLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return
      const anchor = (event.target as Element | null)?.closest(
        'a[href]',
      ) as HTMLAnchorElement | null
      if (
        !anchor ||
        anchor.target === '_blank' ||
        anchor.origin !== window.location.origin ||
        anchor.pathname === window.location.pathname
      )
        return
      if (
        !window.confirm(
          'Hay datos o archivos sin guardar. ¿Quieres salir y descartar esta captura?',
        )
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeLink, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeLink, true)
    }
  }, [dirty])
}
