import consola from 'consola'
import PQueue from 'p-queue'
import mimeTypes from 'mime-types'

// function extractUuid(input: string): string | undefined {
//   const re = /(?<![0-9a-fA-F])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-fA-F])/i
//   const match = input.match(re)
//   return match ? match[0] : undefined
// }

export type CloudreveFile = {
  type: number
  id: string
  name: string
  size: number
  metadata?: Record<string, string>
  path: string
  directUrl?: string
}

type ListResponse = {
  code: number
  msg?: string
  data?: { files: CloudreveFile[] }
}
async function getFinalLink(initialUrl: string): Promise<string | undefined> {
  try {
    let response: Response
    response = await fetch(initialUrl, {
      method: 'HEAD',
      redirect: 'follow',
    })

    if (!response.url.includes('uploads'))
      response = await fetch(initialUrl, {
        method: 'GET',
        redirect: 'follow',
      })

    const url = new URL(response.url)
    // Remove leading '/' from pathname
    let pathname = url.pathname
    if (pathname.startsWith('/')) pathname = pathname.slice(1)

    // Find bucket name: first path segment (e.g. 'red-cat-pictures-cloudreve-1')
    const parts = pathname.split('/')
    if (parts.length < 2) return undefined

    // Remove bucket name; join the rest back into path
    const bucketRelativePath = parts.slice(1).join('/')
    return bucketRelativePath
  } catch (err) {
    consola.warn(err)
    return undefined
  }
}

async function getDirectBucketLink(api: $Fetch<ListResponse, string>, cloudreveUri: string): Promise<string | undefined> {
  // 1. Query Cloudreve for file info
  const infoRes = await api('/file/info', {
    method: 'GET',
    query: { uri: cloudreveUri, extended: true },
  })
  // 2. Get direct link from response
  const directUrl = infoRes.data?.extended_info?.direct_links?.[0]?.url
  return directUrl ? await getFinalLink(directUrl) : undefined
}

async function fetchFilesRecursively(api: $Fetch<ListResponse, string>, rootUri: string, page_size: number, maxDepth: number): Promise<CloudreveFileWithDirectUrl[]> {
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
      files.push(...batch.filter((f) => f.type === 0))
      if (depth < maxDepth) {
        queue.push(...batch.filter((f) => f.type === 1).map((f) => ({ uri: f.path, depth: depth + 1 })))
      }
      if (batch.length < page_size) break
      page += 1
    }
  }
  // For each file, fetch the direct bucket link (serially for clarity, batch for speed)
  const pQueue = new PQueue({ concurrency: 20 })
  return await Promise.all(
    files.map((file) =>
      pQueue.add(async () => {
        const directUrl = await getDirectBucketLink(api, file.path)
        console.log('📂 Direct Link of file', file.path, directUrl)
        return { ...file, directUrl }
      })
    )
  )
}

async function getDriveItemBucketPath(folder: string): Promise<Map<string, string>> {
  const config = useRuntimeConfig()
  const map = new Map<string, string>()
  const api = $fetch.create({
    baseURL: `${config.private.cloudrevePublicUrl}/api/v4`,
    headers: { Authorization: `Bearer ${config.private.cloudreveApiToken}` },
  })

  const res = await fetchFilesRecursively(api, folder, 1000, 100)

  for (const file of res) {
    if (file.type === 1) {
      // type 1 = directory
      // Recursively get inner folder's files
    } else if (file.type === 0) {
      // type 0 = file
      if (file.directUrl) map.set(file.directUrl, file.path)
    }
  }
  return map
}

export default defineCachedEventHandler<
  Promise<
    {
      index: number
      name: string
      media: {
        index: number
        name: string
        size: number
        thumbnail: string
        image: string
        driveUri: string
      }[]
    }[]
  >
>(
  async () => {
    const config = useRuntimeConfig()
    const notionDbId = config.private.notionDbId as unknown as NotionDB

    const bucketItemSlugMap = (
      await r2GetAllFiles(r2Drive, {
        endpoint: config.private.cloudreveR2Endpoint,
        bucket: config.private.cloudreveR2Bucket,
      })
    ).reduce((m, id) => {
      const [_path, ...b] = id.split('_')
      if (b.at(-1) === 'thumb') return m
      m.set(b.join('_').split('.').slice(0, -1).join('.'), id) // key: b.join('_'), value: full path (id)
      return m
    }, new Map<string, string>())

    const driveItemBucketPathMap = await getDriveItemBucketPath('cloudreve://my/media')
    console.log({ driveItemBucketPathMapSize: driveItemBucketPathMap.size })

    const projects = await notionQueryDb<NotionProject>(notion, notionDbId.project)
    const assets = await notionQueryDb<NotionAsset>(notion, notionDbId.asset)

    const fullProject = projects
      .map(({ id, properties }) => ({
        index: properties.Index.number,
        name: properties.Slug.formula.string,
        media: assets
          .filter((asset) => asset.properties.Project.relation[0]?.id === id)
          .map(({ properties }) => {
            const slug = properties.Slug.formula.string

            let relativePath: string | undefined
            let fullPath: string | undefined
            if (bucketItemSlugMap.has(slug)) {
              relativePath = bucketItemSlugMap.get(slug)
              fullPath = `${config.private.cloudreveR2PublicUrl}/${relativePath}`
              bucketItemSlugMap.delete(slug)
            }

            return {
              index: properties.Index.number,
              name: properties.Slug.formula.string,
              mime: mimeTypes.lookup(fullPath),
              size: 100,
              thumbnail: fullPath && `${fullPath}._thumb`,
              image: fullPath,
              driveUri: relativePath && driveItemBucketPathMap.get(relativePath),
            }
          })
          .sort((a, b) => a.index - b.index),
      }))
      .sort((a, b) => a.index - b.index)

    fullProject.push({
      index: -1,
      name: 'no-project',
      media: Array.from(bucketItemSlugMap, ([slug, relativePath], index) => {
        const fullPath = `${config.private.cloudreveR2PublicUrl}/${relativePath}`
        return {
          index,
          name: slug,
          mime: mimeTypes.lookup(fullPath),
          size: 100,
          thumbnail: fullPath && `${fullPath}._thumb`,
          image: fullPath,
          driveUri: driveItemBucketPathMap.get(relativePath),
        }
      }),
    })

    return fullProject as {
      index: number
      name: string
      media: {
        index: number
        name: string
        mime: string
        size: number
        thumbnail: string
        image: string
        driveUri: string
      }[]
    }[]
  },
  { maxAge: 60 * 10 }
)

/* 
// --- Types ---

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

// --- Direct R2/S3 preview (matches Cloudreve UI image open) ---

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
