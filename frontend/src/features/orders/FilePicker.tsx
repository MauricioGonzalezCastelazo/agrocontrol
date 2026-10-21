import { useEffect, useState } from 'react'
import { Camera, Paperclip, X, File as FileIcon } from 'lucide-react'
import { prepareFiles, type SelectedFile } from './pending-files'
import type { AttachmentManifest } from '../../lib/business-api'
import { acceptedFiles, fileTypeLabel, photoPreviewTypes } from '../../lib/attachment-policy'
import { groupNumber } from '../../lib/number-format'

function PhotoPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return (
    <img
      src={url || undefined}
      alt="Vista previa del archivo seleccionado"
      onError={(event) => {
        event.currentTarget.hidden = true
      }}
    />
  )
}

export function FilePicker({
  files,
  onChange,
  onBusy,
  disabled = false,
  existing = [],
}: {
  files: SelectedFile[]
  onChange: (files: SelectedFile[]) => void
  onBusy?: (value: boolean) => void
  disabled?: boolean
  existing?: AttachmentManifest[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function select(list: FileList | null) {
    if (!list) return
    setBusy(true)
    onBusy?.(true)
    setError(null)
    try {
      if (
        existing.length + files.length + list.length > 20 ||
        existing.reduce((sum, file) => sum + file.size_bytes, 0) +
          files.reduce((sum, file) => sum + file.blob.size, 0) +
          Array.from(list).reduce((sum, file) => sum + file.size, 0) >
          100 * 1024 * 1024
      )
        throw new Error('Puedes adjuntar hasta 20 archivos y 100 MB en total.')
      const next = [...files, ...(await prepareFiles(Array.from(list)))]
      if (
        existing.length + next.length > 20 ||
        existing.reduce((sum, file) => sum + file.size_bytes, 0) +
          next.reduce((sum, f) => sum + f.manifest.size_bytes, 0) >
          100 * 1024 * 1024
      )
        throw new Error('Puedes adjuntar hasta 20 archivos y 100 MB en total.')
      onChange(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron seleccionar los archivos.')
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }
  return (
    <div className="file-picker">
      <div className="file-picker-heading">
        <h3>
          <Paperclip size={18} />
          Archivos adjuntos
        </h3>
        <span className="optional">Opcional</span>
      </div>
      <p className="field-hint">
        JPG, PNG, WEBP, HEIC, PDF, Excel, Word, TXT, CSV, ODT y ODS. Hasta 25 MB por archivo, 20
        archivos y 100 MB por pedido. HEIC se guarda como archivo si no hay vista previa compatible.
      </p>
      <div className="file-pick-actions">
        <label
          className={`button button-secondary file-button ${disabled || busy ? 'is-disabled' : ''}`}
        >
          <Paperclip size={17} />
          Seleccionar archivos
          <input
            aria-label="Seleccionar archivos"
            type="file"
            accept={acceptedFiles}
            multiple
            disabled={disabled || busy}
            onChange={(event) => {
              void select(event.target.files)
              event.target.value = ''
            }}
          />
        </label>
        <label
          className={`button button-secondary file-button ${disabled || busy ? 'is-disabled' : ''}`}
        >
          <Camera size={17} />
          Tomar foto
          <input
            aria-label="Tomar foto"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={disabled || busy}
            onChange={(event) => {
              void select(event.target.files)
              event.target.value = ''
            }}
          />
        </label>
      </div>
      {busy && (
        <p role="status" className="field-hint">
          Preparando archivos…
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <ul className="selected-files">
          {files.map((file) => (
            <li key={file.manifest.id}>
              {photoPreviewTypes.includes(file.blob.type) ? (
                <PhotoPreview file={file.blob} />
              ) : (
                <span className="file-symbol">
                  <FileIcon size={20} />
                </span>
              )}
              <div>
                <strong>{file.manifest.filename}</strong>
                <small>
                  {fileTypeLabel(file.manifest.filename)} ·{' '}
                  {groupNumber((file.manifest.size_bytes / 1024).toFixed(1))} KB · Por guardar
                </small>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`Quitar ${file.manifest.filename}`}
                disabled={disabled}
                onClick={() =>
                  onChange(files.filter((item) => item.manifest.id !== file.manifest.id))
                }
              >
                <X size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
