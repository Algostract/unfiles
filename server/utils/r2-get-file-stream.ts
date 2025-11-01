export default async function (objectKey: string, endpoint = import.meta.env.NUXT_PRIVATE_R2_ENDPOINT!, bucket = import.meta.env.NUXT_PRIVATE_R2_BUCKET!) {
  const url = `${endpoint}/${bucket}/${objectKey}`

  const res = await r2Cdn.fetch(url, { method: 'GET' })
  if (!(res.ok && res.body)) {
    throw createError({ statusCode: res.status, message: res.statusText })
  }

  return {
    stream: res.body,
    byteLength: parseInt(res.headers.get('content-length') || '0'),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  }
}
