export default defineEventHandler(async () => {
  const config = useRuntimeConfig().private
  // const allItemKeys = await getAllKeys('uploads:1:media')
  const allItemKeys = await r2GetAllFiles(r2Drive, {
    endpoint: config.cloudreveR2Endpoint,
    bucket: config.cloudreveR2Bucket,
  })

  const result = allItemKeys
    .map((id) => {
      const [path, ...b] = id.split('_')
      if (b.at(-1) === 'thumb') return null

      const originalFilePath = `${process.env.NUXT_PRIVATE_CLOUDREVE_R2_PUBLIC_URL}/${path.replaceAll(':', '/')}_${b.join('_')}`

      return {
        id,
        name: b.join('_'),
        size: 100,
        uri: '',
        thumbnail: `${originalFilePath}._thumb`,
        original: originalFilePath,
      }
    })
    .filter((item) => item !== null)

  return result
})

/* 
// --- Types ---
export type CloudreveFile = {
  type: number
  id: string
  name: string
  size: number
  metadata?: Record<string, string>
  path: string
}
export type ListResponse = {
  code: number
  msg?: string
  data?: { files: CloudreveFile[] }
}

// --- Extension sets ---
const imageExt = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'avif'])
const videoExt = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'])
const audioExt = new Set(['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav'])

function isMedia(file: CloudreveFile): boolean {
  if (file.type !== 0) return false
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return imageExt.has(ext) || videoExt.has(ext) || audioExt.has(ext)
}
function isImage(file: CloudreveFile): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return imageExt.has(ext)
}

// --- Recursively traverse folders/files ---
async function fetchFilesRecursively(
  api: $Fetch<ListResponse, string>,
  rootUri: string,
  page_size: number,
  maxDepth: number
): Promise<CloudreveFile[]> {
  const files: CloudreveFile[] = []
  const queue: Array<{ uri: string; depth: number }> = [{ uri: rootUri, depth: 0 }]
  while (queue.length) {
    const { uri, depth } = queue.shift()!
    consola.log(`📂 Enter folder(depth=${depth}): ${uri} | pending: ${queue.length}`)
    let page = 0
    while (true) {
      consola.log(`📄 Listing page ${page} for ${uri}`)
      const res = await api('/file', { method: 'GET', query: { uri, page, page_size } })
      if (res.code !== 0) {
        consola.error(`❌ List error @ ${uri} p${page}: ${res.msg || 'unknown'}`)
        throw createError({ statusCode: 502, statusMessage: res.msg || 'Cloudreve list error' })
      }
      const batch = res.data?.files || []
      files.push(...batch.filter(f => f.type === 0))
      if (depth < maxDepth) {
        queue.push(...batch.filter(f => f.type === 1).map(f => ({ uri: f.path, depth: depth + 1 })))
      }
      if (batch.length < page_size) break
      page += 1
    }
  }
  return files
}

// --- Thumbnail logic ---
async function getThumbnail(
  api: $Fetch<{ code: number; data: string | { url?: string }; msg?: string }, string>,
  f: CloudreveFile
): Promise<string | null> {
  try {
    if (f.metadata && 'thumb:disabled' in f.metadata) {
      consola.log(`⏭️ Skip thumb (disabled): ${f.name}`)
      return null
    }
    const r = await api('/file/thumb', { method: 'GET', query: { uri: f.path } })
    if (r.code === 0) {
      return typeof r.data === 'string' ? r.data : r.data?.url || null
    }
    return null
  } catch (err) {
    consola.error(`❌ Thumb fetch error: ${f.name} — ${err!.message || err}`)
    return null
  }
}

async function triggerThumbGenerate(
  api: $Fetch<{ code: number; msg?: string }, string>,
  f: CloudreveFile
): Promise<boolean> {
  try {
    consola.log(`🔄 Trigger thumb generation: ${f.name}, ${f.path}`)
    const r = await api('/file/thumb/generate', { method: 'POST', body: { uri: f.path } })
    if (r.code === 0) {
      consola.log(`✨ Thumb generation started for: ${f.name}`)
      return true
    } else {
      consola.warn(`⚠️ Thumb generate API error (${r.code}): ${f.name} — ${r.msg || ''}`)
      return false
    }
  } catch (err) {
    consola.error(`❌ Thumb gen error: ${f.name} — ${err?.message || err}`)
    return false
  }
}

// --- Direct R2/S3 preview (matches Cloudreve UI image open) ---
async function getOriginalPreviewUrl(
  api: $Fetch<{ code: number; msg?: string }, string>,
  f: CloudreveFile
): Promise<string | undefined> {
  try {
    const res = await api<{
      code: number;
      data: {
        link: string;
        file_url: string;
      }[];
      msg: string;
    }>('/file/source', {
      method: 'PUT',
      body: { uris: [f.path] }
    })

    return res.data[0].link//(await fetch(res.data[0].link, { method: 'HEAD', redirect: 'follow' })).url
  } catch (err: any) {
    consola.error(
      `❌ Getting original PREVIEW URL failed for ${f.path}: ${err?.message || err}`
    )
    return
  }
}

// --- Concurrency control ---
async function mapLimit<T, R>(
  arr: T[],
  limit: number,
  fn: (v: T, i: number) => Promise<R>
): Promise<R[]> {
  const ret: R[] = []
  let i = 0
  const exec = async () => {
    while (i < arr.length) {
      const idx = i++
      ret[idx] = await fn(arr[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: limit }).map(exec))
  return ret
}
const THUMB_PARALLEL_LIMIT = 6


export default defineCachedEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const {
    uri = 'cloudreve://my',
    page_size = '200',
    max_depth = '8'
  } = getQuery(event) as { uri?: string; page_size?: string; max_depth?: string }

  // Create a single Cloudreve API client
  const api = $fetch.create({
    baseURL: `${config.private.cloudrevePublicUrl}/api/v4`,
    headers: { Authorization: `Bearer ${config.private.cloudreveApiToken}` },
  })

  const allFiles = await fetchFilesRecursively(api, uri, Number(page_size), Number(max_depth))
  consola.log(`🧮 Total files collected (all depths): ${allFiles.length}`)

  const mediaFiles = allFiles.filter(isMedia)
  const imgCount = mediaFiles.filter(isImage).length
  const vidCount = mediaFiles.filter(f => videoExt.has((f.name.split('.').pop() || '').toLowerCase())).length
  const audCount = mediaFiles.filter(f => audioExt.has((f.name.split('.').pop() || '').toLowerCase())).length
  consola.log(`🖼️ Images: ${imgCount}  🎬 Videos: ${vidCount}  🎵 Audios: ${audCount}  🧩 Total media: ${mediaFiles.length}`)

  // Limit thumbnail calls & provide direct original link logic
  const results = await mapLimit(mediaFiles, THUMB_PARALLEL_LIMIT, async (f) => {
    let thumbnail: string | null = null;
    if (isImage(f)) {
      thumbnail = await getThumbnail(api, f)
      if (!thumbnail) {
        const generated = await triggerThumbGenerate(api, f)
        if (generated) {
          await new Promise((res) => setTimeout(res, 750))
          thumbnail = await getThumbnail(api, f)
        } else {
          consola.warn(`⚠️ Could not generate thumbnail for image: ${f.name}`)
        }
      }
    } else {
      thumbnail = await getThumbnail(api, f)
    }

    // --- Direct link for originals ---
    let original: string | undefined
    if (isMedia(f))
      original = await getOriginalPreviewUrl(api, f)


    return {
      id: f.id,
      name: f.name,
      size: f.size,
      uri: f.path,
      thumbnail,
      original,
    }
  })

  consola.log(`📦 Returning ${results.length} media items`)
  return { count: results.length, items: results }
}, { swr: true, maxAge: 60 * 60, staleMaxAge: 30 })
 */
