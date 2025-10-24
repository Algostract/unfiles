import { createIPX, ipxFSStorage } from 'ipx'
import { hash } from 'ohash'

const mime: Record<string, string> = {
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

    for (const key of allItemKeys) {
      const [_, ...b] = key.split('_')
      nameToPathMap[b.join('_')] = key
    }

    return nameToPathMap
  },
  { maxAge: 60 }
)

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

export default defineEventHandler(async (event) => {
  const r2 = useStorage('r2')
  const cloudreveR2 = useStorage('cloudreveR2')
  const fs = useStorage('fs')

  const raw = event.context.params?._ || ''
  console.log('🛬 Incoming', { method: event.node.req.method, url: event.node.req.url, raw })

  const [rawArgs, source] = raw.split('/')
  if (!source) {
    throw createError({ statusCode: 404, statusMessage: 'Missing source' })
  }

  const normArgs = normalizeArgs(rawArgs)
  console.log('🧩 Parames', { source, rawArgs, normArgs })

  const modifiers = await parseIpxArgs(normArgs)
  console.log('⚙️  Modifiers', modifiers)

  const fmt = modifiers.format || 'avif'

  const cacheHash = hash({ src: source, args: normArgs })
  const cacheKey = `cache/${cacheHash}.${fmt}`
  console.log('🗝️  Cache key', { cacheKey })

  if (await r2.hasItem(cacheKey)) {
    const cached = await r2.getItemRaw(cacheKey)
    if (cached) {
      const bytes = new Uint8Array(cached as ArrayBuffer)
      const mime: Record<string, string> = {
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
      const ct = mime[fmt] || 'application/octet-stream'
      setHeader(event, 'Content-Type', ct)
      setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
      setHeader(event, 'Content-Length', bytes.byteLength)
      console.log('✅ Cache HIT', { bytes: bytes.byteLength, ct })
      return bytes
    }
  }

  const nameToPathMap = await syncDrive()
  const mappedSource = nameToPathMap[source]

  if (!mappedSource) {
    throw createError({ statusCode: 404, statusMessage: 'Missing media' })
  }

  await fs.setItemRaw(source, Buffer.from((await cloudreveR2.getItemRaw<ArrayBuffer>(mappedSource))!))

  console.log('🛠️ Transform START', { source, modifiers })
  const { data } = await ipx(source, modifiers).process()

  if (typeof data == 'string') {
    throw createError({ statusCode: 404, statusMessage: 'Data is string' })
  }
  console.log('📦 Transform DONE', { bytes: data.byteLength })
  ;(async () => {
    await r2.setItemRaw(cacheKey, data)
    await fs.removeItem(source)
    console.log('💾 Saved to cache', { cacheKey, bytes: data.byteLength })
  })()

  const ct = mime[fmt] || 'application/octet-stream'
  setHeader(event, 'Content-Type', ct)
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setHeader(event, 'Content-Length', data.byteLength)

  return data
})
