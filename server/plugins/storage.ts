import s3Driver from 'unstorage/drivers/s3'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig().private
  const storage = useStorage()

  // Dynamically pass in credentials from runtime configuration, or other sources
  const driver = s3Driver({
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
    endpoint: config.r2Endpoint,
    bucket: config.r2Bucket,
    region: config.r2Region,
  })

  // Mount driver
  storage.mount('r2', driver)


  // Dynamically pass in credentials from runtime configuration, or other sources
  const cloudreveDriver = s3Driver({
    accessKeyId: config.cloudreveR2AccessKeyId,
    secretAccessKey: config.cloudreveR2SecretAccessKey,
    endpoint: config.cloudreveR2Endpoint,
    bucket: config.cloudreveR2Bucket,
    region: config.cloudreveR2Region,
  })

  // Mount driver
  storage.mount('cloudreveR2', cloudreveDriver)
})
