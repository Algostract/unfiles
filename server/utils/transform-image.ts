import { consola } from 'consola'
import PQueue from 'p-queue'

const queue = new PQueue({
  intervalCap: parseInt(process.env.RATE_LIMIT_INTERVAL_CAP || '5'),
  interval: parseInt(process.env.RATE_LIMIT_INTERVAL || '1000'),
})

const transform = (cacheKey: string, mappedSource: string, modifiers: Record<string, string | number | boolean>) =>
  queue.add(async () => {
    const source = `${process.env.NUXT_PRIVATE_CLOUDREVE_R2_PUBLIC_URL}/${encodeURI(mappedSource)}`
    const ipxUrl = `${process.env.INTERNAL_BASE_URL}/_ipx/${stringifyIpxArgs(modifiers)}/${source}`

    const res = await fetch(ipxUrl, { method: 'GET' })
    if (!res.ok || !res.body) {
      console.log({ ipxUrl }, '🚧 Data is undefined')
      throw createError({ statusCode: 404, message: '🚧 Data is undefined' })
    }

    // consola.log('📦 Transform DONE', { cacheKey, bytes: buffer.byteLength })
    const byteLength = parseInt(res.headers.get('content-length') ?? '0')
    const [toDisk, toR2] = res.body.tee()
    const diskCacheKey = `./static/${cacheKey}`

    // Cache to Storage

    r2PutFileStream(cacheKey, toR2, byteLength)
      .then(() => {
        consola.info('💾 Saved to R2 cache', { cacheKey, bytes: byteLength })
      })
      .then(() => diskPutFileStream(diskCacheKey, toDisk))
      .then(() => {
        consola.info('💾 Saved to FS cache', { cacheKey, bytes: byteLength })
      })
      .catch((error) => {
        consola.error('Failed to save to cache', error)
      })

    return {
      stream: res.body,
      byteLength: parseInt(res.headers.get('content-length') ?? '0'),
      contentType: res.headers.get('content-type') ?? undefined,
    }
  })

export default transform
