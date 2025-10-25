import { createIPX, ipxFSStorage } from 'ipx'
import { hash } from 'ohash'
import PQueue from 'p-queue'

const formatMime = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  heif: 'image/heif',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
}

const ipx = createIPX({
  storage: ipxFSStorage({ dir: './static' }),
})

const syncDrive = defineCachedFunction(
  async () => {
    const config = useRuntimeConfig().private

    const nameToPathMap: { [key: string]: string } = {}
    const allItemKeys = await r2GetAllFiles({
      accessKeyId: config.cloudreveR2AccessKeyId,
      secretAccessKey: config.cloudreveR2SecretAccessKey,
      endpoint: config.cloudreveR2Endpoint,
      bucket: config.cloudreveR2Bucket,
      region: config.cloudreveR2Region || 'auto',
    })

    for (const path of allItemKeys) {
      const [_, ...b] = path.split('_')
      if (b.at(-1) === 'thumb') continue

      const key = b.join('_').split('.').slice(0, -1).join('.')
      nameToPathMap[key] = path
    }

    return nameToPathMap
  },
  { swr: true, staleMaxAge: 60 * 5, maxAge: 86400 }
)

const queue = new PQueue({ concurrency: 1 })

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

const disabledMimeType = (mime: string, accept: string) => {
  return accept
    .split(',')
    .map((p) => p.trim())
    .some((p) => p.startsWith(mime) && /;q=0(\.0+)?\b/.test(p))
}

const supportsMimeType = (mime: string, accept: string) => {
  if (!accept) return false
  if (disabledMimeType(mime, accept)) return false
  return accept.includes(mime)
}

export default defineEventHandler<Promise<Buffer>>(async (event) => {
  console.time('transform-total')
  const cloudreveR2 = useStorage('cloudreveR2')
  const r2 = useStorage('r2')
  const fs = useStorage('fs')

  const raw = event.context.params?._ || ''
  // console.log('🛬 Incoming', { method: event.node.req.method, url: event.node.req.url, raw })

  const [rawArgs, source] = raw.split('/')
  if (!source) {
    throw createError({ statusCode: 404, statusMessage: 'Missing source' })
  }

  const normArgs = normalizeArgs(rawArgs)
  // console.log('🧩 Parames', { source, rawArgs, normArgs })
  const modifiers = await parseIpxArgs(normArgs)
  // console.log('⚙️  Modifiers', modifiers)

  if (!modifiers.format) {
    const accept = (getRequestHeader(event, 'accept') || '').toLowerCase()
    let negotiated
    if (supportsMimeType('image/avif', accept)) negotiated = 'avif'
    else if (supportsMimeType('image/webp', accept)) negotiated = 'webp'
    else if (accept.includes('image/*') || accept.includes('*/*') || accept.includes('image/')) negotiated = 'jpeg'
    modifiers.format = negotiated || 'jpeg'
  }
  const format = modifiers.format as keyof typeof formatMime
  setResponseHeader(event, 'Content-Type', formatMime[format] ?? 'application/octet-stream')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet')
  setResponseHeader(event, 'Vary', 'Accept')

  const cacheHash = hash({ src: source, args: normArgs })
  const cacheKey = `cache/${cacheHash}.${format}`

  if (await fs.hasItem(cacheKey)) {
    const data = Buffer.from((await fs.getItemRaw<ArrayBuffer>(cacheKey))!)

    console.log('✅ FS Cache HIT', { cacheKey, bytes: data.byteLength })
    console.timeEnd('transform-total')
    // return await sendRedirect(event, `${config.private.r2PublicUrl}/${cacheKey}`, 301)
    return data
  }

  if (await r2.hasItem(cacheKey)) {
    const data = Buffer.from((await r2.getItemRaw<ArrayBuffer>(cacheKey))!)

    console.log('✅ R2 Cache HIT', { cacheKey, bytes: data.byteLength })
    fs.setItemRaw(cacheKey, data).then(() => {
      console.log('💾 Saved to FS cache', { cacheKey, bytes: data.byteLength })
    })

    console.timeEnd('transform-total')
    // return await sendRedirect(event, `${config.private.r2PublicUrl}/${cacheKey}`, 301)
    return data
  }

  const mappedSource = (await syncDrive())[source]
  if (!mappedSource) {
    throw createError({ statusCode: 404, statusMessage: 'Missing media' })
  }

  return await queue.add(async () => {
    console.log('⚠️ Cache MISS', { cacheKey })
    // console.log('🛠️ Transform START', { source, modifiers })
    await fs.setItemRaw(source, Buffer.from((await cloudreveR2.getItemRaw<ArrayBuffer>(mappedSource))!))

    const { data } = await ipx(source, modifiers).process()
    await fs.removeItem(source)

    if (typeof data == 'string') {
      throw createError({ statusCode: 404, statusMessage: 'Data is string' })
    }
    // console.log('📦 Transform DONE', { cacheKey, bytes: data.byteLength })

    fs.setItemRaw(cacheKey, data).then(async () => {
      console.log('💾 Saved to FS cache', { cacheKey })
    })
    r2.setItemRaw(cacheKey, data).then(async () => {
      console.log('💾 Saved to R2 cache', { cacheKey })
    })

    console.timeEnd('transform-total')
    // return await sendRedirect(event, `${config.private.r2PublicUrl}/${cacheKey}`, 301)
    return data
  })
})
