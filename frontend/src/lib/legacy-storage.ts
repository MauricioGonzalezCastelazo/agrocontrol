const names = [
  'agrocontrol-local-workspace',
  'agrocontrol-pending-attachments',
  'agrocontrol-pending-payments',
  'agrocontrol-authorized-cache',
]

// Never import the old workspace engine here: opening it could upgrade its schema.
// Inspect only existing databases and abort creation if another tab removes one.
export async function legacyInformation(): Promise<'present' | 'empty' | 'unknown'> {
  try {
    if (!indexedDB.databases) return 'unknown'
    const databases = await indexedDB.databases()
    for (const name of names.filter((name) => databases.some((db) => db.name === name))) {
      const found = await new Promise<boolean>((resolve, reject) => {
        const opening = indexedDB.open(name)
        opening.onupgradeneeded = () => {
          opening.transaction?.abort()
          reject(new Error('Database changed'))
        }
        opening.onerror = () => reject(opening.error)
        opening.onblocked = () => reject(new Error('Database busy'))
        opening.onsuccess = () => {
          const db = opening.result
          const stores = Array.from(db.objectStoreNames)
          if (!stores.length) {
            db.close()
            resolve(false)
            return
          }
          const transaction = db.transaction(stores, 'readonly')
          let found = false
          for (const store of stores) {
            const count = transaction.objectStore(store).count()
            count.onsuccess = () => {
              if (count.result > 0) found = true
            }
          }
          transaction.oncomplete = () => {
            db.close()
            resolve(found)
          }
          transaction.onerror = () => {
            db.close()
            reject(transaction.error)
          }
          transaction.onabort = () => {
            db.close()
            reject(transaction.error)
          }
        }
      })
      if (found) return 'present'
    }
    return 'empty'
  } catch {
    return 'unknown'
  }
}
