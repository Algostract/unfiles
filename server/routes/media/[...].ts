import { createIPX, ipxFSStorage } from 'ipx'
import { hash } from 'ohash'

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
  { swr: true, staleMaxAge: 60 * 7, maxAge: 60 * 10 }
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

// Simple helper honoring q=0 exclusions
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

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const r2 = useStorage('r2')
  const cloudreveR2 = useStorage('cloudreveR2')
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

  setResponseHeader(event, 'Vary', 'Accept')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet') // Instruct crawlers not to index this redirecting URL
  setResponseHeader(event, 'Cache-Control', 'no-store, private') // Optional: avoid caching the redirect response

  if (!modifiers.format) {
    const accept = (getRequestHeader(event, 'accept') || '').toLowerCase()

    // Negotiate best-supported format
    let negotiated: 'avif' | 'webp' | 'jpeg' | undefined
    if (supportsMimeType('image/avif', accept)) negotiated = 'avif'
    else if (supportsMimeType('image/webp', accept)) negotiated = 'webp'
    else if (accept.includes('image/*') || accept.includes('*/*') || accept.includes('image/')) negotiated = 'jpeg'

    modifiers.format = negotiated || 'jpeg'
  }

  const cacheHash = hash({ src: source, args: normArgs })
  const cacheKey = `cache/${cacheHash}.${modifiers.format}`

  if (await r2.hasItem(cacheKey)) {
    console.log('✅ Cache HIT', { cacheKey })
    return await sendRedirect(event, `${config.private.r2PublicUrl}/${cacheKey}`, 301)
  }

  console.log('⚠️ Cache MISS', { cacheKey })
  const nameToPathMap = await syncDrive()
  const mappedSource = nameToPathMap[source]

  if (!mappedSource) {
    throw createError({ statusCode: 404, statusMessage: 'Missing media' })
  }

  // console.log('🛠️ Transform START', { source, modifiers })
  await fs.setItemRaw(source, Buffer.from((await cloudreveR2.getItemRaw<ArrayBuffer>(mappedSource))!))
  const { data } = await ipx(source, modifiers).process()

  if (typeof data == 'string') {
    throw createError({ statusCode: 404, statusMessage: 'Data is string' })
  }
  // console.log('📦 Transform DONE', { bytes: data.byteLength })

  await r2.setItemRaw(cacheKey, data)
  await fs.removeItem(source)
  console.log('💾 Saved to cache', { cacheKey, bytes: data.byteLength })

  return await sendRedirect(event, `${config.private.r2PublicUrl}/${cacheKey}`, 301)
})
