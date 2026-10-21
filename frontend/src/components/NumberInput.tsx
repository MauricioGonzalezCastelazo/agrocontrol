import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes } from 'react'
import { groupNumber, numericEdit } from '../lib/number-format'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
}

export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput(
  { value, onChange, onKeyDown, ...props },
  ref,
) {
  const input = useRef<HTMLInputElement | null>(null)
  const selection = useRef<{ start: number; end: number } | null>(null)
  useLayoutEffect(() => {
    if (selection.current && input.current === document.activeElement) {
      input.current?.setSelectionRange(selection.current.start, selection.current.end)
      selection.current = null
    }
  })
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={groupNumber(value)}
      ref={(element) => {
        input.current = element
        if (typeof ref === 'function') ref(element)
        else if (ref) ref.current = element
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        const node = event.currentTarget,
          caret = node.selectionStart
        if (event.defaultPrevented || caret === null || caret !== node.selectionEnd) return
        // Deleting at a separator removes the adjacent digit, rather than trapping the cursor.
        if (event.key === 'Backspace' && node.value[caret - 1] === ',')
          node.setSelectionRange(caret - 1, caret - 1)
        if (event.key === 'Delete' && node.value[caret] === ',')
          node.setSelectionRange(caret + 1, caret + 1)
      }}
      onChange={(event) => {
        const node = event.currentTarget
        const edit = numericEdit(node.value, node.selectionStart || 0, node.selectionEnd || 0)
        selection.current = edit
        node.value = edit.formatted
        onChange(edit.value)
        node.setSelectionRange(edit.start, edit.end)
      }}
    />
  )
})
