import { consola } from 'consola'
import pMemoize from 'p-memoize'
import PQueue from 'p-queue'
import { createIPX, ipxFSStorage, ipxHttpStorage } from 'ipx'
import { contentType as lookup } from 'mime-types'
import ExpiryMap from 'expiry-map'

const ipx = createIPX({
  storage: ipxFSStorage({ dir: './static' }),
  httpStorage: ipxHttpStorage({ allowAllDomains: true }),
})

const queue = new PQueue({
  intervalCap: parseInt(process.env.RATE_LIMIT_INTERVAL_CAP || '5'),
  interval: parseInt(process.env.RATE_LIMIT_INTERVAL || '1000'),
})

const cache = new ExpiryMap(parseInt(process.env.RATE_LIMIT_CACHE_TTL || '10000'))

function toArrayBuffer(input: Buffer | Uint8Array | ArrayBuffer): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input
  const u8 = Buffer.isBuffer(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : input

  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

const transform = pMemoize(
  (cacheKey: string, mappedSource: string, modifiers: Record<string, string | number | boolean>) =>
    queue.add(async () => {
      const source = `${process.env.NUXT_PRIVATE_CLOUDREVE_R2_PUBLIC_URL}/${encodeURI(mappedSource)}`
      // consola.log('🛠️ Transform START', { source, modifiers })

      const { data } = await ipx(source, modifiers).process()
      if (typeof data === 'string') {
        throw createError({ statusCode: 500, message: 'data is a string' })
      }

      const buffer = toArrayBuffer(data as Buffer | Uint8Array | ArrayBuffer)

      const mime = (typeof modifiers.format === 'string' && (lookup(modifiers.format) || undefined)) || 'application/octet-stream'

      // consola.log('📦 Transform DONE', { cacheKey, bytes: buffer.byteLength })
      const dataStream = new Response(buffer).body!
      const [toDisk, toR2] = dataStream.tee()
      const diskCacheKey = `./static/${cacheKey}`

      // Cache to Storage
      r2PutFileStream(cacheKey, toR2, data.byteLength)
        .then(() => {
          consola.info('💾 Saved to R2 cache', { cacheKey, bytes: data.byteLength })
        })
        .then(() => diskPutFileStream(diskCacheKey, toDisk))
        .then(() => {
          consola.info('💾 Saved to FS cache', { cacheKey, bytes: data.byteLength })
        })
        .catch((error) => {
          consola.error('Failed to save to cache', error)
        })

      return {
        stream: new Response(buffer).body!,
        byteLength: buffer.byteLength,
        contentType: mime,
      } as {
        stream: ReadableStream
        byteLength: number
        contentType: string
      }
    }),
  { cache }
)

export default transform
