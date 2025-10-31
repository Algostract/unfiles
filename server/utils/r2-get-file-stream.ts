export default async function (objectKey: string) {
  const endpoint = import.meta.env.NUXT_PRIVATE_R2_ENDPOINT!
  const bucket = import.meta.env.NUXT_PRIVATE_R2_BUCKET!
  const url = `${endpoint}/${bucket}/${objectKey}`

  const res = await r2Cdn.fetch(url, { method: 'GET' })
  if (!(res.ok && res.body)) {
    throw createError({ statusCode: res.status, message: 'R2 CDN GET failed' })
  }

  return {
    stream: res.body,
    byteLength: parseInt(res.headers.get('content-length') || '0'),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  }
}
