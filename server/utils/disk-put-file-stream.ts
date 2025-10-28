import { createWriteStream } from 'node:fs'
import { Writable } from 'node:stream'

export default async function (outPath: string, webStream: ReadableStream) {
  const fs = useStorage('fs')
  fs.setItem(outPath, '')
  const file = createWriteStream(outPath)
  const webWritable = Writable.toWeb(file)
  await webStream.pipeTo(webWritable)
}
