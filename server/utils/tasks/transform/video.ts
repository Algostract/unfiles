import mime from 'mime-types'
import { createWriteStream } from 'node:fs'
import { Writable } from 'node:stream'

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

  const source = `${encodeURI(mediaOriginId)}`
  // consola.log('🛠️ Transform START', { source, modifiers })

  // check if file already exists
  if (!(await fs.hasItem(source.replaceAll('/', '_')))) {
    const { stream } = await r2GetFileStream(source, config.private.cloudreveR2Endpoint, config.private.cloudreveR2Bucket) // Web ReadableStream<Uint8Array>
    await stream.pipeTo(Writable.toWeb(createWriteStream(`./static/${source.replaceAll('/', '_')}`)))
  }

  await transcodeVideo(
    `./static/${source.replaceAll('/', '_')}`,
    cachePath,
    { width: parseInt((modifiers.w as string) ?? '1080'), height: parseInt((modifiers.h as string) ?? '1080') },
    (modifiers.codec as 'avc' | 'vp9' | 'hevc' | 'av1') ?? 'av1',
    'cpu'
  )
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
