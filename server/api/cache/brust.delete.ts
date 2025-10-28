import type { Storage, StorageValue } from 'unstorage'
import pMap from 'p-map'

async function clearDir(storage: Storage<StorageValue>, base: string, driver: 'fs' | 's3') {
  const config = useRuntimeConfig().private
  const prefix = base.endsWith('/') ? base : base + '/'

  const keys =
    driver === 's3'
      ? await r2GetAllFiles(r2Drive, {
          endpoint: config.r2Endpoint,
          bucket: config.r2Bucket,
        })
      : await storage.getKeys(prefix)
  const filteredKeys = keys.filter((k: string) => k.includes(prefix))

  await pMap(filteredKeys, async (k) => storage.removeItem(k), { concurrency: 50 })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<string[]>(event)
  const r2 = useStorage('r2')
  const fs = useStorage('fs')

  if (body.some((x) => x === 'cache')) {
    await Promise.all([clearDir(r2, 'cache', 's3'), clearDir(fs, 'cache', 'fs')])

    return { status: 'Cache cleaned' }
  }

  for await (const item of body) {
    await Promise.all([r2.removeItem(item), fs.removeItem(item)])
  }

  return { status: 'Cached items cleaned' }
})
