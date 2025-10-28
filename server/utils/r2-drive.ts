import { AwsClient } from 'aws4fetch'

/* type R2Config = {
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  bucket: string
  region?: string // for R2: 'auto'
} */

const r2DriveClientSingleton = () => {
  return new AwsClient({
    accessKeyId: process.env.NUXT_PRIVATE_CLOUDREVE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.NUXT_PRIVATE_CLOUDREVE_R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: process.env.NUXT_PRIVATE_CLOUDREVE_R2_REGION || 'auto',
  })
}

declare const globalThis: {
  r2DriveGlobal: ReturnType<typeof r2DriveClientSingleton>
} & typeof global

const r2Drive = globalThis.r2DriveGlobal ?? r2DriveClientSingleton()

export default r2Drive

if (process.env.NODE_ENV !== 'production') globalThis.r2DriveGlobal = r2Drive
