import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Writable } from 'node:stream'

export default async function (outPath: string, webStream: ReadableStream) {
  await mkdir(dirname(outPath), { recursive: true })

  const file = createWriteStream(outPath)
  const webWritable = Writable.toWeb(file)
  await webStream.pipeTo(webWritable)
}
