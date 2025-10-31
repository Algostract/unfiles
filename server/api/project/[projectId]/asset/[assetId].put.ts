import mimeTypes from 'mime-types'
// type FileSplitParts = {
//   path: string
//   uuid: string
//   filename: string
//   extension: string
// }

// function splitFilePath(input: string): FileSplitParts | undefined {
//   const re = /^(.*\/)([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_([^/]+)\.([^./]+)$/i
//   const match = input.match(re)
//   if (!match) return undefined
//   const [, path, uuid, filename, extension] = match
//   return { path, uuid, filename, extension }
// }

function normalizeExtension(ext: string) {
  // Remove leading dot and lowercase the string
  const clean = ext.replace(/^\./, '').toLowerCase()
  const type = mimeTypes.lookup(clean) // e.g., 'image/jpeg'
  const normalizedExt = mimeTypes.extension(type) // e.g., 'jpg'
  return normalizedExt || clean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ action: 'rename' | 'thumbnail'; uri: string; name: string }>(event)
  const config = useRuntimeConfig()
  const fs = useStorage('fs')

  if (!body.uri) throw createError({ statusCode: 400, statusMessage: 'uri is missing' })

  const api = $fetch.create({
    baseURL: `${config.private.cloudrevePublicUrl}/api/v4`,
    headers: { Authorization: `Bearer ${config.private.cloudreveApiToken}` },
  })

  if (body.action == 'thumbnail') {
    const uri = body.uri
    const r = await api('/file/thumb', { method: 'GET', query: { uri } })
    console.log({ r })
    if (r.code === 0) {
      console.log(`✨ Thumb generation started for: ${uri}`)
      return true
    } else {
      console.warn(`⚠️ Thumb generate API error (${r.code}): ${uri} | ${r.msg || ''}`)
      return false
    }
  } else if (body.action === 'rename') {
    const { data } = await api('/file/info', {
      method: 'GET',
      query: { uri: body.uri, extended: true },
    })

    // 2. Extract download URL from file info response
    // console.log({ data })
    const directUrl = data.extended_info.direct_links?.[0]?.url
    if (!directUrl) throw new Error('Direct download link not found for file')

    // 3. Download file from that direct URL (fetch or axios or $fetch)
    const fileData = await $fetch(directUrl, { responseType: 'arrayBuffer' })
    const [_oldName, unnormalizeExtension] = data.name.split('.')
    const extension = normalizeExtension(unnormalizeExtension)
    // Step 2: Rename file on local disk
    await fs.setItemRaw(`${body.name}.${extension}`, Buffer.from(fileData))
    const oldDataPath = data.path
    const newDataPath = `${data.path.split('/').slice(0, -1).join('/')}/${body.name}.${extension}`

    // Step 5: Delete old file
    await api('/file', {
      method: 'DELETE',
      body: {
        uris: [oldDataPath],
      },
    })

    // console.log({ resDel, path: oldDataPath })
    // Step 3: Upload renamed file to Cloudreve, at target path
    await api('/file/content', {
      method: 'PUT',
      body: Buffer.from(fileData),
      query: { uri: newDataPath },
    })

    // if (oldDataPath !== newDataPath) {
    // }

    // Optionally: Delete local temp file
    // await fs.unlink(newFileLocal)

    // Optionally: Generate thumbnail, etc.

    return { status: 'success', uploaded: `${body.name}.${extension}` }
  }
})
