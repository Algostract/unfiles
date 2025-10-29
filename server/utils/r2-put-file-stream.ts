import mimeTypes from 'mime-types'

export default async function (objectKey: string, webStream: ReadableStream, byteLength: number) {
  const endpoint = process.env.NUXT_PRIVATE_R2_ENDPOINT!
  const bucket = process.env.NUXT_PRIVATE_R2_BUCKET!
  const url = `${endpoint}/${bucket}/${objectKey}`

  let res: Response
  const contentType = mimeTypes.contentType(mimeTypes.lookup(objectKey) || 'application/octet-stream') || 'application/octet-stream'
  try {
    res = await r2Cdn.fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': byteLength.toString(),
      },
      body: new Blob([await new Response(webStream).blob()], { type: contentType }),
    })
  } catch (err) {
    // Network/connection error -> reject fetch
    throw new Error('Failed to upload (network error)', { cause: err as unknown }) // ES2022 cause
  }

  if (!res.ok) {
    let bodyText = ''
    try {
      bodyText = await res.text()
    } catch {
      /* empty */
    }
    const reason = res.statusText || 'HTTP error'
    const details = bodyText ? ` — ${bodyText.slice(0, 2000)}` : ''
    throw new Error(`Failed to upload: ${res.status} ${reason}${details}`)
  }

  return true
}
