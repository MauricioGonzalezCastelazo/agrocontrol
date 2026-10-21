import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

window.scrollTo = vi.fn()
configure({ asyncUtilTimeout: 5000 })

afterEach(cleanup)
