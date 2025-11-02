/* eslint-disable @typescript-eslint/no-explicit-any */
import PQueue from 'p-queue'
import consola from 'consola'
import mimeTypes from 'mime-types'

// function extractUuid(input: string): string | undefined {
//   const re = /(?<![0-9a-fA-F])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-fA-F])/i
//   const match = input.match(re)
//   return match ? match[0] : undefined
// }

export type CloudreveFile = {
  type: number // 0=file, 1=folder
  id: string
  name: string
  size: number
  metadata?: Record<string, string>
  path: string // Cloudreve file URI
}

type ListResponse = {
  code: number
  msg?: string
  data?: { files: CloudreveFile[] }
}

type InfoResponse = {
  code: number
  msg?: string
  data?: any // contains extended_info?.direct_links when extended=true
}

type Options = {
  pageSize?: number
  maxDepth?: number
  listConcurrency?: number
  linkConcurrency?: number
  retries?: number
  retryBaseMs?: number
  logEveryN?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function backoffDelay(attempt: number, base: number) {
  // exponential with jitter
  const exp = base * Math.pow(2, attempt)
  return Math.min(exp, 30_000) * (0.5 + Math.random())
}

async function withRetry<T>(fn: () => Promise<T>, { retries = 4, base = 300, label }: { retries?: number; base?: number; label?: string } = {}): Promise<T> {
  let lastErr: any
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      const status = err?.status || err?.response?.status
      const retryAfter = err?.response?.headers?.get?.('retry-after') || err?.headers?.get?.('retry-after')
      if (i === retries) break
      // Retry on 429/5xx or network errors
      if (status && status < 500 && status !== 429) throw err
      const wait = retryAfter ? Number(retryAfter) * 1000 : backoffDelay(i, base)
      consola.warn(`${label || 'retry'} attempt=${i + 1} wait=${Math.round(wait)}ms status=${status || 'n/a'}`)
      await sleep(wait)
    }
  }
  throw lastErr
}

// Resolve to the final URL after redirects; prefer HEAD to skip bodies and fall back to GET if necessary.
async function resolveFinalUrl(initialUrl: string): Promise<string> {
  // HEAD first
  let res = await fetch(initialUrl, { method: 'HEAD', redirect: 'follow' })
  if (res.status === 405 || res.status === 403 || res.status === 400) {
    res = await fetch(initialUrl, { method: 'GET', redirect: 'follow' })
  }
  // Some environments may have edge-case redirect handling; GET fallback covers most practical servers.
  return res.url
}

// Extract bucket relative path by removing the first path segment (bucket name).
function toBucketRelativePath(finalUrl: string): string | undefined {
  const url = new URL(finalUrl)
  const pathname = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname
  const parts = pathname.split('/')
  if (parts.length < 2) return undefined
  return parts.slice(1).join('/')
}

export async function getFinalLink(initialUrl: string): Promise<string | undefined> {
  try {
    const finalUrl = await resolveFinalUrl(initialUrl)
    return toBucketRelativePath(finalUrl)
  } catch (err) {
    consola.warn('final-link error', err)
    return undefined
  }
}

export async function getDirectBucketLink(api: $Fetch<InfoResponse, string>, cloudreveUri: string): Promise<string | undefined> {
  const infoRes = await withRetry(
    () =>
      api('/file/info', {
        method: 'GET',
        query: { uri: cloudreveUri, extended: true },
      }),
    { label: 'file/info' }
  )
  const directUrl = infoRes?.data?.extended_info?.direct_links?.[0]?.url as string | undefined
  if (!directUrl) return undefined
  return await getFinalLink(directUrl)
}

type CloudreveFileWithDirectUrl = CloudreveFile & { directUrl?: string }

async function fetchFilesRecursively(api: $Fetch<ListResponse, string>, rootUri: string, opt: Options = {}): Promise<CloudreveFileWithDirectUrl[]> {
  const { pageSize = 200, maxDepth = 5, listConcurrency = 6, linkConcurrency = 20, retries = 4, retryBaseMs = 300, logEveryN = 200 } = opt

  consola.info(`Start list root=${rootUri} pageSize=${pageSize} maxDepth=${maxDepth} listC=${listConcurrency} linkC=${linkConcurrency}`)

  const listQ = new PQueue({ concurrency: listConcurrency })
  const linkQ = new PQueue({ concurrency: linkConcurrency })

  const files: CloudreveFile[] = []
  const seenDirs = new Set<string>()
  let listedDirs = 0
  let foundFiles = 0

  async function listOneDir(uri: string, depth: number) {
    if (seenDirs.has(uri)) return
    seenDirs.add(uri)
    let page = 0
    listedDirs++
    while (true) {
      const res = await withRetry(() => api('/file', { method: 'GET', query: { uri, page, page_size: pageSize } }), { retries, base: retryBaseMs, label: 'list' })
      if (res.code !== 0) {
        throw Object.assign(new Error(res.msg || 'Cloudreve list error'), {
          status: 502,
        })
      }
      const batch = res.data?.files ?? []
      const fileItems = batch.filter((f) => f.type === 0)
      const dirItems = batch.filter((f) => f.type === 1)
      files.push(...fileItems)
      foundFiles += fileItems.length

      if (foundFiles % logEveryN === 0) {
        consola.info(`Listed files=${foundFiles} dirs=${listedDirs} depth=${depth} page=${page}`)
      }

      if (depth < maxDepth) {
        for (const d of dirItems) {
          listQ.add(() => listOneDir(d.path, depth + 1))
        }
      }
      if (batch.length < pageSize) break
      page++
    }
  }

  await listQ.add(() => listOneDir(rootUri, 0))
  await listQ.onIdle()

  consola.info(`Listing done: files=${foundFiles} uniqueDirs=${listedDirs}`)

  const out: CloudreveFileWithDirectUrl[] = new Array(files.length)
  let resolved = 0

  await Promise.all(
    files.map((file, idx) =>
      linkQ.add(async () => {
        const directUrl = await withRetry(() => getDirectBucketLink(api as any, file.path), { retries, base: retryBaseMs, label: 'direct' }).catch((err) => {
          consola.warn(`direct-link fail path=${file.path}`, err)
          return undefined
        })
        resolved++
        if (resolved % logEveryN === 0) {
          consola.info(`Resolved direct links ${resolved}/${files.length}`)
        }
        out[idx] = { ...file, directUrl }
      })
    )
  )

  await linkQ.onIdle()
  consola.info(`All direct links resolved: total=${files.length}`)
  return out
}

async function getDriveItemBucketPath(folder: string): Promise<Map<string, string>> {
  const config = useRuntimeConfig()
  const map = new Map<string, string>()
  const api = $fetch.create({
    baseURL: `${config.private.cloudrevePublicUrl}/api/v4`,
    headers: { Authorization: `Bearer ${config.private.cloudreveApiToken}` },
  })

  const res = await fetchFilesRecursively(api, folder)

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
  { swr: true, staleMaxAge: 60 * 20 }
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
