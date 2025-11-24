import { createWriteStream } from 'node:fs'
import { Writable } from 'node:stream'
import z from 'zod'
import { syncDrive } from '~~/server/routes/media/[kind]/[...rest]'

export default defineEventHandler(async (event) => {
  const fs = useStorage('fs')
  const config = useRuntimeConfig()

  const { id } = await getValidatedRouterParams(
    event,
    z.object({
      id: z.string().min(1),
    }).parse
  )

  const mediaOriginId = (await syncDrive())[id]

  const mediaId = encodeURI(mediaOriginId).replaceAll('/', '_')
  const source = `./source/${mediaId}`
  // check if file already exists
  if (!(await fs.hasItem(source))) {
    const { stream } = await r2GetFileStream(encodeURI(mediaOriginId), config.private.cloudreveR2Endpoint, config.private.cloudreveR2Bucket) // Web ReadableStream<Uint8Array>
    await stream.pipeTo(Writable.toWeb(createWriteStream(`./static/${source}`)))
  }

  const metaData = await getVideoMetadata(`./static/${source}`)
  return metaData
})
