import { useLocation } from 'react-router-dom'

export function useBase() {
  return useLocation().pathname.startsWith('/vista-previa') ? '/vista-previa' : ''
}
