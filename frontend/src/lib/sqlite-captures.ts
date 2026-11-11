import type { SelectedFile } from '../features/orders/pending-files'
import { localFetch, localRequest } from './local-api'
import { ApiError } from './api-error'

type Row = { key: string; scope: string; [field: string]: unknown }
type Snapshot = { revision: number; data: Record<string, Row[]> }

// Only recovery captures live here. Business records use the normalized shared API.
// Compare-and-swap commits each recovery transaction without overwriting other tabs.
class SQLiteTable {
  constructor(
    private store: SQLiteCaptures,
    private name: string,
  ) {}
  async get(key: string) {
    return this.store.read(this.name, (rows) => rows.find((row) => row.key === key))
  }
  async put(row: Row) {
    return this.bulkPut([row])
  }
  async bulkPut(rows: Row[]) {
    const encoded: Row[] = []
    for (const row of rows) {
      const file = row as unknown as SelectedFile
      if (file.blob instanceof Blob) {
        await localRequest('/local/blobs', { method: 'POST', body: JSON.stringify(file.manifest) })
        await localRequest(`/local/blobs/${file.manifest.id}`, { method: 'PUT', body: file.blob })
        encoded.push({ ...row, blob: { localBlob: file.manifest.id } })
      } else encoded.push(row)
    }
    return this.store.write(this.name, (current) => {
      for (const row of encoded) {
        const index = current.findIndex((old) => old.key === row.key)
        if (index < 0) current.push(row)
        else current[index] = row
      }
    })
  }
  async update(key: string, patch: Partial<Row>) {
    return this.store.write(this.name, (rows) => {
      const row = rows.find((entry) => entry.key === key)
      if (row) Object.assign(row, patch)
    })
  }
  async delete(key: string) {
    return this.store.write(this.name, (rows) => {
      const index = rows.findIndex((row) => row.key === key)
      if (index >= 0) rows.splice(index, 1)
    })
  }
  where(index: string) {
    return {
      equals: (value: unknown) => {
        const fields = index.startsWith('[') ? index.slice(1, -1).split('+') : [index]
        const values = Array.isArray(value) ? value : [value]
        const matches = (row: Row) => fields.every((field, i) => row[field] === values[i])
        const collection = (predicate: (row: Row) => boolean): object => ({
          toArray: () => this.store.read(this.name, (rows) => rows.filter(predicate)),
          count: () => this.store.read(this.name, (rows) => rows.filter(predicate).length),
          filter: (filter: (row: Row) => boolean) =>
            collection((row) => predicate(row) && filter(row)),
          delete: () =>
            this.store.write(this.name, (rows) => {
              for (let i = rows.length - 1; i >= 0; i--) if (predicate(rows[i])) rows.splice(i, 1)
            }),
        })
        return collection(matches)
      },
    }
  }
}

export class SQLiteCaptures {
  files = new SQLiteTable(this, 'files')
  drafts = new SQLiteTable(this, 'drafts')
  payments = new SQLiteTable(this, 'payments')
  constructor(private snapshot?: Snapshot) {}
  private queue: Promise<unknown> = Promise.resolve()
  async read<T>(table: string, fn: (rows: Row[]) => T): Promise<T> {
    const snapshot = this.snapshot || (await localRequest<Snapshot>('/local/store'))
    return fn(snapshot.data[table])
  }
  async write(table: string, fn: (rows: Row[]) => void) {
    if (this.snapshot) return fn(this.snapshot.data[table])
    return this.transaction('rw', async (transaction) => fn(transaction.snapshot!.data[table]))
  }
  async transaction<T>(_mode: string, callback: (transaction: SQLiteCaptures) => Promise<T>) {
    const run = async () => {
      // A transaction owns its tables. Concurrent calls on the root store must
      // never join its snapshot or resolve before their own commit succeeds.
      const transaction = new SQLiteCaptures(await localRequest<Snapshot>('/local/store'))
      const result = await callback(transaction)
      await localRequest('/local/store', {
        method: 'PUT',
        body: JSON.stringify(transaction.snapshot),
      })
      return result
    }
    const operation = this.queue.then(run, run)
    this.queue = operation.catch(() => undefined)
    return operation
  }
}

export async function hydrateLocalFile<T extends SelectedFile>(file: T): Promise<T> {
  if (file.blob instanceof Blob) return file
  const reference = file.blob as unknown as { localBlob: string }
  if (!reference?.localBlob) throw new ApiError(409, 'Falta el documento de la captura.')
  const bytes = await (await localFetch(`/local/blobs/${reference.localBlob}`)).blob()
  return { ...file, blob: new File([bytes], file.manifest.filename) }
}
