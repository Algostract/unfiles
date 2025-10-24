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
  { swr: true, staleMaxAge: 60 * 5, maxAge: 86400 }
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

  setResponseHeader(event, 'Vary', 'Accept')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet') // Instruct crawlers not to index this redirecting URL
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400')

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

  if (await fs.hasItem(cacheKey)) {
    console.log('✅ FS Cache HIT', { cacheKey })
    const data = await fs.getItemRaw(cacheKey)

    console.timeEnd('transform-total')
    // return await sendRedirect(event, `${config.private.r2PublicUrl}/${cacheKey}`, 301)
    return data
  }

  if (await r2.hasItem(cacheKey)) {
    console.log('✅ R2 Cache HIT', { cacheKey })
    const data = (await r2.getItemRaw<ArrayBuffer>(cacheKey))!
    fs.setItemRaw(source, Buffer.from(data)).then(() => {
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

  console.log('⚠️ Cache MISS', { cacheKey })

  // console.log('🛠️ Transform START', { source, modifiers })
  await fs.setItemRaw(cacheKey, Buffer.from((await cloudreveR2.getItemRaw<ArrayBuffer>(mappedSource))!))
  const { data } = await ipx(cacheKey, modifiers).process()

  if (typeof data == 'string') {
    throw createError({ statusCode: 404, statusMessage: 'Data is string' })
  }
  // console.log('📦 Transform DONE', { bytes: data.byteLength })

  r2.setItemRaw(cacheKey, data).then(() => {
    console.log('💾 Saved to FS & R2 cache', { cacheKey, bytes: data.byteLength })
  })
  // fs.removeItem(cacheKey)

  console.timeEnd('transform-total')
  // return await sendRedirect(event, `${config.private.r2PublicUrl}/${cacheKey}`, 301)
  return data
})
