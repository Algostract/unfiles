import type { ReadStream } from 'node:fs'
import { createReadStream, statSync } from 'node:fs'
import { consola } from 'consola'
import { hash } from 'ohash'
import { lookup, contentType, types as mimeTypes } from 'mime-types'

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

async function transform(cacheKey: string, mappedSource: string, modifiers: Record<string, string | number | boolean>) {
  const source = `drive/${encodeURI(mappedSource)}`
  const ipxUrl = `${process.env.INTERNAL_BASE_URL}/_ipx/${stringifyIpxArgs(modifiers)}/${source}`

  const res = await fetch(ipxUrl, { method: 'GET' })
  if (!res.ok || !res.body) {
    console.log({ ipxUrl }, '🚧 Data is undefined')
    throw createError({ statusCode: 404, message: '🚧 Data is undefined' })
  }

  return {
    stream: res.body,
    byteLength: parseInt(res.headers.get('content-length') ?? '0'),
    contentType: res.headers.get('content-type') ?? undefined,
  }
}

export default defineEventHandler<Promise<ReadStream | ReadableStream>>(async (event) => {
  try {
    console.time('transform-total')
    const r2 = useStorage('r2')
    const fs = useStorage('fs')

    const raw = event.context.params?._ || ''

    const [rawArgs, source] = raw.split('/')
    if (!source) {
      throw createError({ statusCode: 404, message: '🚧 Missing source' })
    }

    const args = normalizeArgs(rawArgs)
    const modifiers = await parseIpxArgs(args)

    if (!modifiers.format) {
      const accept = (getRequestHeader(event, 'accept') || '').toLowerCase()
      let negotiated
      if (supportsMimeType('image/avif', accept)) negotiated = 'avif'
      else if (supportsMimeType('image/webp', accept)) negotiated = 'webp'
      else if (accept.includes('image/*') || accept.includes('*/*') || accept.includes('image/')) negotiated = 'jpeg'
      modifiers.format = negotiated || 'jpeg'
    }

    setResponseHeader(event, 'Content-Type', mimeTypes[`${modifiers.format}`] ?? 'application/octet-stream')
    setResponseHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet')
    setResponseHeader(event, 'Vary', 'Accept')

    const cacheHash = hash({ source, args })
    const cacheKey = `cache/${cacheHash}.${modifiers.format}`
    const diskCacheKey = `./static/${cacheKey}`

    if (await fs.hasItem(cacheKey)) {
      const data = {
        stream: createReadStream(diskCacheKey),
        contentType: contentType(lookup(diskCacheKey) || 'application/octet-stream') || 'application/octet-stream',
        byteLength: statSync(diskCacheKey).size,
      }

      consola.success('✅ FS Cache HIT', { cacheKey, bytes: data.byteLength })

      console.timeEnd('transform-total')
      setResponseHeader(event, 'Content-Type', data.contentType)
      setResponseHeader(event, 'Content-Length', data.byteLength)
      return data.stream
    }

    if (await r2.hasItem(cacheKey)) {
      const data = await r2GetFileStream(cacheKey)
      const [toDisk, toClient] = data.stream.tee()

      consola.success('✅ R2 Cache HIT', { cacheKey, bytes: data.byteLength })
      diskPutFileStream(diskCacheKey, toDisk).then(() => {
        consola.info('💾 Saved to FS cache', { cacheKey, bytes: data.byteLength })
      })

      console.timeEnd('transform-total')
      setResponseHeader(event, 'Content-Type', data.contentType)
      setResponseHeader(event, 'Content-Length', data.byteLength)
      return toClient
    }

    const mappedSource = (await syncDrive())[source]
    if (!mappedSource) {
      throw createError({ statusCode: 404, message: '🚧 Missing media' })
    }

    consola.warn('⚠️ Cache MISS', { cacheKey })

    const data = await transform(cacheKey, mappedSource, modifiers)
    console.timeEnd('transform-total')
    const [toStorage, toClient] = data.stream.tee()
    const [toDisk, toR2] = toStorage.tee()

    await diskPutFileStream(diskCacheKey, toDisk).then(() => {
      consola.info('💾 Saved to FS cache', { cacheKey, bytes: data.byteLength })
    })
    await r2PutFileStream(cacheKey, toR2, { contentType: data.contentType, byteLength: data.byteLength }).then(() => {
      consola.info('💾 Saved to FS cache', { cacheKey, bytes: data.byteLength })
    })

    setResponseHeader(event, 'Content-Type', data.contentType)
    setResponseHeader(event, 'Content-Length', data.byteLength)
    return toClient
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) {
      throw error
    }
    console.error('Route media GET', error)
    throw createError({ statusCode: 500, message: 'Some Unknown Error Found' })
  }
})
