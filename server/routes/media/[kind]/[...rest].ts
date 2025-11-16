import z from 'zod'
import consola from 'consola'
import mime from 'mime-types'
import { hash } from 'ohash'
import type { H3Event, EventHandlerRequest } from 'h3'
import type { ReadStream } from 'node:fs'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

function normalizeArgs(rawArgs: string) {
  const decodedArgs = decodeURIComponent(rawArgs || '')
    .replace(/%2C/gi, ',')
    .replace(/&/g, ',')
    .replace(/\s+/g, '')
  const tokens = decodedArgs
    .split(',')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  const normArgs = tokens.join(',')

  return normArgs
}

function disabledMimeType(mime: string, accept: string) {
  return accept
    .split(',')
    .map((p) => p.trim())
    .some((p) => p.startsWith(mime) && /;q=0(\.0+)?\b/.test(p))
}

function supportsMimeType(mime: string, accept: string) {
  if (!accept) return false
  if (disabledMimeType(mime, accept)) return false
  return accept.includes(mime)
}

function negotiateImageFormat(event: H3Event<EventHandlerRequest>): { format: 'avif' | 'webp' | 'jpeg' } {
  let format: 'avif' | 'webp' | 'jpeg' = 'jpeg'

  const acceptHeader = getRequestHeader(event, 'accept') || ''
  const accept = (acceptHeader || '').toLowerCase()

  if (supportsMimeType('image/avif', accept)) format = 'avif'
  else if (supportsMimeType('image/webp', accept)) format = 'webp'

  return { format }
}

function negotiateVideoFormat(event: H3Event<EventHandlerRequest>): {
  format: string
  codec: string
} {
  const accept = (getRequestHeader(event, 'accept') || '').toLowerCase()

  let format: 'mp4' | 'webm' | 'ogg' = 'mp4'
  if (supportsMimeType('video/av1', accept) || supportsMimeType('video/webm', accept)) format = 'webm'
  else if (supportsMimeType('video/ogg', accept)) format = 'ogg'

  const codecStr = accept.match(/codecs="([^"]+)"/i)?.[1]?.toLowerCase() || ''
  let codec = codecStr.includes('av1')
    ? 'av1'
    : codecStr.includes('vp9')
      ? 'vp9'
      : codecStr.includes('hevc') || codecStr.includes('hvc1')
        ? 'hevc'
        : codecStr.includes('avc') || codecStr.includes('h264')
          ? 'avc'
          : null

  // fallback codec per format
  if (!codec) codec = format === 'webm' ? 'vp9' : format === 'ogg' ? 'theora' : 'avc'

  return {
    format,
    codec,
  }
}

function getChunkRange(event: H3Event<EventHandlerRequest>, bufferSize: number): { chunkStart: number; chunkEnd: number; chunkSize: number } {
  const range = getRequestHeader(event, 'range')
  let chunkStart = 0
  let chunkEnd = bufferSize - 1
  let chunkSize = bufferSize

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    chunkStart = parseInt(parts[0], 10)
    chunkEnd = parts[1] ? parseInt(parts[1], 10) : bufferSize - 1
    chunkSize = chunkEnd - chunkStart + 1
  }

  return { chunkStart, chunkEnd, chunkSize }
}

function buildCacheKey({ kind, source, args, ext }: { kind: string; source: string; args: string; ext: string }) {
  const keyHash = hash({ kind, source, args })
  return `cache/${kind}/${keyHash}.${ext}`
}

const syncDrive = defineCachedFunction(
  async () => {
    consola.log('🔄 Syncing Drive')
    const config = useRuntimeConfig().private

    const nameToPathMap: { [key: string]: string } = {}
    const allItemKeys = await r2GetAllFiles(r2Drive, {
      endpoint: config.cloudreveR2Endpoint,
      bucket: config.cloudreveR2Bucket,
    })

    for (const path of allItemKeys) {
      const [_, ...b] = path.split('_')
      if (b.at(-1) === 'thumb') continue

      const key = b.join('_').split('.').slice(0, -1).join('.')
      nameToPathMap[key] = path
    }

    return nameToPathMap
  },
  { swr: true, staleMaxAge: 60 * 7, maxAge: 60 * 10 }
)

export default defineEventHandler(async (event) => {
  try {
    const { kind, rest } = await getValidatedRouterParams(event, z.object({ kind: z.enum(['image', 'audio', 'video']), rest: z.string().min(1) }).parse)
    const [rawArgs, mediaId] = rest.split('/')

    if (!mediaId) throw createError({ statusCode: 400, message: 'Missing media mediaId' })

    const args = normalizeArgs(rawArgs)

    const r2 = useStorage('r2')
    const fs = useStorage('fs')

    setResponseHeaders(event, {
      // 'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
      'cache-control': 'public, max-age=31536000, immutable',
    })
    // Pipeline of image
    if (kind === 'image') {
      const modifiers = parseIpxArgs(args)

      const { format } = negotiateImageFormat(event)
      modifiers.format = !modifiers.format || modifiers.format === 'auto' ? format : modifiers.format
      // consola.log('⚙️ Image Modifiers', modifiers)

      const contentType = mime.types[`${modifiers.format}`] ?? 'application/octet-stream'
      setResponseHeaders(event, {
        vary: 'accept',
        'content-type': contentType,
      })

      const cacheKey = buildCacheKey({ kind, source: mediaId, args, ext: modifiers.format as string })
      const cachePath = `./static/${cacheKey}`

      // FS cache
      if (await fs.hasItem(cacheKey)) {
        const metaData = await fs.getMeta(cacheKey)
        const data = {
          stream: createReadStream(cachePath),
          contentType,
          byteLength: metaData.size,
        }

        if (event.method === 'HEAD') {
          return
        }

        consola.success('✅ Image FS Cache HIT', { cacheKey, bytes: data.byteLength })
        return data.stream
      }

      // R2 cache
      if (await r2.hasItem(cacheKey)) {
        const data = await r2GetFileStream(cacheKey)
        const [toDisk, toClient] = data.stream.tee()

        diskPutFileStream(cachePath, toDisk).then(() => {
          consola.info('💾 Image Saved to FS cache', { cacheKey, bytes: data.byteLength })
        })

        if (event.method === 'HEAD') {
          return
        }

        consola.success('✅ Image R2 Cache HIT', { cacheKey, bytes: data.byteLength })
        return toClient
      }

      const mediaOriginId = (await syncDrive())[mediaId]
      if (!mediaOriginId) {
        throw createError({ statusCode: 404, message: '🚧 Missing media' })
      }

      consola.warn('⚠️ Image Cache MISS', { cacheKey })

      const { result: data } = await executeTask<{
        streamPath: string
        contentType: string
        byteLength: number
      }>('transform:image', { payload: { cacheKey, mediaOriginId, modifiers } })

      if (!data?.streamPath) {
        throw createError({ statusCode: 500, statusMessage: 'No stream generated' })
      }

      const stream = Readable.toWeb(createReadStream(data.streamPath))
      const [storageStream, playbackStream] = stream.tee()

      // Cache to Storage (fire-and-forget; errors are logged)
      r2PutFileStream(cacheKey, storageStream as ReadableStream, data.byteLength)
        .then(() => {
          consola.info('💾 Image Saved to R2 cache', { cacheKey, bytes: data.byteLength })
        })
        .catch((error) => {
          consola.error('Failed to save to cache', error)
        })

      return playbackStream
    } // Pipeline of audio
    else if (kind === 'audio') {
      // const cacheKey = buildCacheKey({ kind, source: mediaId, args, ext: 'mp3' })
      // const cachePath = `./static/${cacheKey}`
    } // Pipeline of video
    else {
      const modifiers = parseIpxArgs(args)

      const { format, codec } = negotiateVideoFormat(event)
      modifiers.format = !modifiers.format || modifiers.format === 'auto' ? format : modifiers.format
      modifiers.codec = !modifiers.codec || modifiers.codec === 'auto' ? codec : modifiers.codec
      // consola.log('⚙️ Video Modifiers', modifiers)

      const CODEC_MAP = {
        av1: 'av1',
        hevc: 'hvc1, mp4a.40.2',
        vp9: 'vp9, vorbis',
        avc: 'avc1.42E01E, mp4a.40.2',
      }

      const rangeHeader = getRequestHeader(event, 'range')
      const mimeType = `video/${modifiers.format}`

      const codecDetail = modifiers?.codec ? CODEC_MAP[modifiers.codec as 'av1' | 'hevc' | 'vp9' | 'avc'] : ''
      const contentType = `${mimeType}; codecs="${codecDetail}"`
      setResponseHeaders(event, {
        'accept-ranges': 'bytes',
        'content-type': contentType,
      })

      const cacheKey = buildCacheKey({ kind, source: mediaId, args, ext: modifiers.format as string })
      const cachePath = `./static/${cacheKey}`

      // FS cache
      if (await fs.hasItem(cacheKey)) {
        const metaData = await fs.getMeta(cacheKey)
        const byteLength = metaData.size as number

        const data: {
          stream?: ReadStream
          contentType?: string
          byteLength?: number
        } = {}

        if (!rangeHeader) {
          setResponseHeaders(event, {
            'content-length': byteLength,
          })

          if (event.method === 'HEAD') {
            return
          }
          data.stream = createReadStream(cachePath)
          data.contentType = contentType
          data.byteLength = byteLength
        } else {
          const { chunkStart: start, chunkEnd: end } = getChunkRange(event, byteLength)
          const length = end - start + 1

          setResponseStatus(event, 206)

          setResponseHeaders(event, {
            'content-length': length,
            'content-range': `bytes ${start}-${end}/${byteLength}`,
          })

          if (event.method === 'HEAD') {
            return
          }
          data.stream = createReadStream(cachePath, { start, end })
          data.contentType = contentType
          data.byteLength = length
        }

        consola.success('✅ Video FS Cache HIT', { cacheKey, bytes: data.byteLength })
        return data.stream
      }

      // R2 cache
      if (await r2.hasItem(cacheKey)) {
        const { stream, byteLength } = await r2GetFileStream(cacheKey)
        const [diskStream, clientStream] = stream.tee()

        const rangeHeader = getRequestHeader(event, 'range')

        const data: {
          stream?: ReadableStream
          contentType?: string
          byteLength?: number
        } = {}

        if (!rangeHeader) {
          setResponseHeaders(event, {
            'content-length': byteLength,
          })

          data.stream = clientStream
          data.contentType = contentType
          data.byteLength = byteLength
        } else {
          const { chunkStart: start, chunkEnd: end } = getChunkRange(event, byteLength)
          const length = end - start + 1

          setResponseStatus(event, 206)

          setResponseHeaders(event, {
            'content-length': length,
            'content-range': `bytes ${start}-${end}/${byteLength}`,
          })

          data.stream = clientStream.pipeThrough(streamRangeSlice(start, end))
          data.contentType = contentType
          data.byteLength = length
        }

        // Save to FS cache in background
        diskPutFileStream(cachePath, diskStream).then(() => {
          consola.info('💾 Video Saved to FS cache', { cacheKey, bytes: data.byteLength })
        })

        consola.success('✅ Video R2 Cache HIT', { cacheKey, bytes: data.byteLength })
        return data.stream as ReadableStream
      }

      const mediaOriginId = (await syncDrive())[mediaId]
      if (!mediaOriginId) {
        throw createError({ statusCode: 404, message: '🚧 Missing media' })
      }

      consola.warn('⚠️ Video Cache MISS', { cacheKey })

      if (event.method === 'HEAD') {
        return
      }

      const { result: data } = await executeTask<{
        streamPath: string
        contentType: string
        byteLength: number
      }>('transform:video', { payload: { cacheKey, mediaOriginId, modifiers } })

      if (!data?.streamPath) {
        throw createError({ statusCode: 500, statusMessage: 'No stream generated' })
      }

      const stream = Readable.toWeb(createReadStream(data.streamPath))
      const [storageStream, playbackStream] = stream.tee()

      // Cache to Storage (fire-and-forget; errors are logged)
      r2PutFileStream(cacheKey, storageStream as ReadableStream, data.byteLength)
        .then(() => {
          consola.info('💾 Video Saved to R2 cache', { cacheKey, bytes: data.byteLength })
        })
        .catch((error) => {
          consola.error('Failed to save to cache', error)
        })

      return playbackStream
    }
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) {
      throw error
    }

    consola.error('Route media GET', error)
    throw createError({ statusCode: 500, message: 'Some Unknown Error Found' })
  }
})
