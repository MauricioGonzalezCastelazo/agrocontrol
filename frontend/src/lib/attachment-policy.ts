import policy from '../../../backend/app/domain/attachment-policy.json'

export const acceptedFiles = policy.extensions.join(',')
export function allowedFilename(filename: string) {
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return policy.extensions.includes(extension)
}
export function fileTypeLabel(filename: string) {
  return filename.split('.').pop()?.toUpperCase() || 'Archivo'
}
export const photoPreviewTypes = policy.preview_types
