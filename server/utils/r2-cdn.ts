import { AwsClient } from 'aws4fetch'

/* type R2Config = {
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  bucket: string
  region?: string // for R2: 'auto'
} */

const r2CdnClientSingleton = () => {
  return new AwsClient({
    accessKeyId: import.meta.env.NUXT_PRIVATE_R2_ACCESS_KEY_ID!,
    secretAccessKey: import.meta.env.NUXT_PRIVATE_R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: import.meta.env.NUXT_PRIVATE_R2_REGION || 'auto',
  })
}

declare const globalThis: {
  r2CdnGlobal: ReturnType<typeof r2CdnClientSingleton>
} & typeof global

const r2Cdn = globalThis.r2CdnGlobal ?? r2CdnClientSingleton()

export default r2Cdn

if (import.meta.env.NODE_ENV !== 'production') globalThis.r2CdnGlobal = r2Cdn
