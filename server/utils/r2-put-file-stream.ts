export default async function (objectKey: string, webStream: ReadableStream, opts: { contentType?: string; byteLength: number }) {
  const endpoint = process.env.NUXT_PRIVATE_R2_ENDPOINT!
  const bucket = process.env.NUXT_PRIVATE_R2_BUCKET!
  const url = `${endpoint}/${bucket}/${objectKey}`

  const headers: Record<string, string> = {}

  headers['Content-Type'] = opts.contentType || 'application/octet-stream'
  headers['Content-Length'] = opts.byteLength.toString()
  // headers['x-amz-content-sha256']

  const res = await r2Cdn.fetch(url, {
    method: 'PUT',
    headers,
    body: webStream, // Web ReadableStream streaming upload
  })
  if (!(res.ok && res.body)) {
    throw createError({ statusCode: res.status, message: 'R2 CDN GET failed' })
  }

  return {
    status: 'ok',
  }
}
