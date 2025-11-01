import consola from 'consola'
import mime from 'mime-types'
import { createIPX, ipxFSStorage, ipxHttpStorage } from 'ipx'

const ipx = createIPX({
  storage: ipxFSStorage({ dir: './static' }),
  httpStorage: ipxHttpStorage({ allowAllDomains: true }),
})

function ensureBuffer(input: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input))
  return Buffer.from(input)
}

export default async function (payload: Record<string, string>): Promise<{
  streamPath: string
  contentType: string
  byteLength: number
}> {
  console.time('transform-total')
  const cacheKey = payload.cacheKey as unknown as string
  const mediaOriginId = payload.mediaOriginId as unknown as string
  const modifiers = payload.modifiers as unknown as Record<string, string | number | boolean>
  const cachePath = `./static/${cacheKey}`
  const fs = useStorage('fs')

  const source = `${import.meta.env.NUXT_PRIVATE_CLOUDREVE_R2_PUBLIC_URL}/${encodeURI(mediaOriginId)}`
  // consola.log('🛠️ Transform START', { source, modifiers })

  // check if file already exists
  const { data } = await ipx(source, modifiers).process()
  if (typeof data === 'string') {
    throw createError({ statusCode: 500, message: 'data is a string' })
  }
  const fileBuffer = ensureBuffer(data as Buffer | Uint8Array | ArrayBuffer)
  await fs.setItemRaw(cacheKey, fileBuffer)

  const metaData = await fs.getMeta(cacheKey)
  const byteLength = metaData.size as number

  const contentType = (typeof modifiers.format === 'string' && (mime.contentType(modifiers.format) || undefined)) || 'application/octet-stream'
  // Create a single Web ReadableStream from the buffer and tee it twice so
  // we have three consumers without creating extra large intermediate Blobs:
  // - one stream returned to the caller (client)
  // - one stream uploaded to R2
  // - one stream written to disk
  // Convert to Uint8Array for a clean BodyInit type for the runtime fetch/Response

  Bun.gc()
  consola.log('🧹 Garbage collection complete.')

  console.timeEnd('transform-total')
  return {
    streamPath: cachePath,
    byteLength,
    contentType,
  }
}
