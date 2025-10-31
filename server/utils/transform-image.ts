import { consola } from 'consola'
import PQueue from 'p-queue'
import { createIPX, ipxFSStorage, ipxHttpStorage } from 'ipx'
import { contentType as lookup } from 'mime-types'

const ipx = createIPX({
  storage: ipxFSStorage({ dir: './static' }),
  httpStorage: ipxHttpStorage({ allowAllDomains: true }),
})

const queue = new PQueue({
  // Limit concurrency to avoid multiple large in-memory buffers at once.
  concurrency: parseInt(import.meta.env.TRANSFORM_CONCURRENCY || '2'),
  intervalCap: parseInt(import.meta.env.RATE_LIMIT_INTERVAL_CAP || '5'),
  interval: parseInt(import.meta.env.RATE_LIMIT_INTERVAL || '1000'),
})

function ensureBuffer(input: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input))
  return Buffer.from(input)
}

const transform = (cacheKey: string, mappedSource: string, modifiers: Record<string, string | number | boolean>) =>
  queue.add(async () => {
    const source = `${import.meta.env.NUXT_PRIVATE_CLOUDREVE_R2_PUBLIC_URL}/${encodeURI(mappedSource)}`
    // consola.log('🛠️ Transform START', { source, modifiers })

    const { data } = await ipx(source, modifiers).process()
    if (typeof data === 'string') {
      throw createError({ statusCode: 500, message: 'data is a string' })
    }

    const buf: Buffer = ensureBuffer(data as Buffer | Uint8Array | ArrayBuffer)
    const byteLength = buf.length

    const mime = (typeof modifiers.format === 'string' && (lookup(modifiers.format) || undefined)) || 'application/octet-stream'

    // Create a single Web ReadableStream from the buffer and tee it twice so
    // we have three consumers without creating extra large intermediate Blobs:
    // - one stream returned to the caller (client)
    // - one stream uploaded to R2
    // - one stream written to disk
    // Convert to Uint8Array for a clean BodyInit type for the runtime fetch/Response
    const u8 = new Uint8Array(buf)
    const dataStream = new Response(u8).body!
    const [clientStream, cacheStream] = dataStream.tee()
    const [toDisk, toR2] = cacheStream.tee()
    const diskCacheKey = `./static/${cacheKey}`

    // Cache to Storage (fire-and-forget; errors are logged)
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
      stream: clientStream,
      byteLength,
      contentType: mime,
    } as {
      stream: ReadableStream
      byteLength: number
      contentType: string
    }
  })

export default transform
