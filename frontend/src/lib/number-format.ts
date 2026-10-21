// String operations preserve every decimal digit, including unfinished input.
export function groupNumber(value: string) {
  const match = /^(-?)(\d*)(\.\d*)?$/.exec(value)
  if (!match) return value
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] || ''}`
}

export function numericEdit(text: string, start: number, end = start) {
  const value = text.replace(/,/g, '')
  const formatted = groupNumber(value)
  const position = (offset: number) => {
    const digits = text.slice(0, offset).replace(/,/g, '').length
    let count = 0,
      index = 0
    while (index < formatted.length && count < digits) {
      if (formatted[index] !== ',') count++
      index++
    }
    return index
  }
  return { value, formatted, start: position(start), end: position(end) }
}
