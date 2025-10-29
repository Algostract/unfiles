import { consola } from 'consola'

export default async function (objectKey: string, webStream: ReadableStream, opts: { contentType?: string; byteLength: number }) {
  const endpoint = process.env.NUXT_PRIVATE_R2_ENDPOINT!
  const bucket = process.env.NUXT_PRIVATE_R2_BUCKET!
  const url = `${endpoint}/${bucket}/${objectKey}`

  const headers: Record<string, string> = {}

  headers['Content-Type'] = opts.contentType || 'application/octet-stream'
  headers['Content-Length'] = opts.byteLength.toString()

  consola.info(headers)

  const res = await r2Cdn.fetch(url, {
    method: 'PUT',
    headers,
    body: webStream,
  })
  if (!(res.ok && res.body)) {
    throw createError({ statusCode: res.status, message: 'R2 CDN Upload failed' })
  }

  return {
    status: 'ok',
  }
}
