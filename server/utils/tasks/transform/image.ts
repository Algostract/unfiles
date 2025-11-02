import mime from 'mime-types'
import { createIPX, ipxFSStorage } from 'ipx'
import { createWriteStream } from 'node:fs'
import { Writable } from 'node:stream'

const ipx = createIPX({
  storage: ipxFSStorage({ dir: './static' }),
})

function ensureBuffer(input: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input))
  return Buffer.from(input)
}

export function isVideoPath(path: string): boolean {
  const type = mime.lookup(path)
  return typeof type === 'string' && (type.startsWith('video/') || type === 'application/mp4')
}

export default async function (payload: Record<string, string>): Promise<{
  streamPath: string
  contentType: string
  byteLength: number
}> {
  const cacheKey = payload.cacheKey as unknown as string
  const mediaOriginId = payload.mediaOriginId as unknown as string
  const modifiers = payload.modifiers as unknown as Record<string, string | number | boolean>
  const cachePath = `./static/${cacheKey}`
  const fs = useStorage('fs')
  const config = useRuntimeConfig()

  const mediaId = encodeURI(mediaOriginId).replaceAll('/', '_')
  const source = `source/${mediaId}`
  await ensureDir('./static/source')
  // console.log('🛠️ Transform START', { source, modifiers })

  // check if file already exists
  if (!(await fs.hasItem(source))) {
    const { stream } = await r2GetFileStream(encodeURI(mediaOriginId), config.private.cloudreveR2Endpoint, config.private.cloudreveR2Bucket) // Web ReadableStream<Uint8Array>
    await stream.pipeTo(Writable.toWeb(createWriteStream(`./static/${source}`)))
  }

  const isVideo = isVideoPath(`./static/${source}`)
  if (isVideo) {
    await ensureDir(`./static/thumbnail/${mediaId}`)
    await generateThumbnail(`./static/${source}`, `./static/thumbnail`, '00:00:00.500')
  }

  const { data } = await ipx(isVideo ? `thumbnail/${mediaId.replace(/\.[^/.]+$/, '.jpg')}` : source, modifiers).process()
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

  return {
    streamPath: cachePath,
    byteLength,
    contentType,
  }
}
