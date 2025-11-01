/* eslint-disable @typescript-eslint/no-explicit-any */
import PQueue from 'p-queue'
import consola from 'consola'
import transformImage from './transform/image'
import transformVideo from './transform/video'

// One queue per task-name, sequential (concurrency: 1)
const queues = new Map<string, PQueue>()
const inflight = new Map<string, Promise<any>>() // key -> running promise

function getQueue(name: string) {
  let q = queues.get(name)
  if (!q) {
    q = new PQueue({ concurrency: 1 })
    queues.set(name, q)
    consola.info(`🧵 [${name}] queue created (concurrency=1)`)

    // Helpful lifecycle consolas
    q.on('empty', () => {
      consola.info(`📭 [${name}] queue empty (size=${q!.size}, pending=${q!.pending})`)
    })
    q.on('idle', () => {
      consola.info(`💤 [${name}] queue idle (size=${q!.size}, pending=${q!.pending})`)
    })
    // Not all versions expose 'pendingZero', keep the two above for portability
  }
  return q
}

function makeInflightKey(name: string, payload?: Record<string, any>) {
  // For stronger stability, replace with a stable stringify if needed.
  return `${name}:${JSON.stringify(payload ?? {})}`
}

export default async function <T>(name: string, { payload }: { payload?: Record<string, any> } = {}): Promise<{ result: T }> {
  const key = makeInflightKey(name, payload)
  const queue = getQueue(name)

  // Return same promise if identical job is already running
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) {
    consola.info(`🔁 [${name}] dedupe hit for key=${key}`)
    const result = await existing
    consola.success(`🟢 [${name}] deduped result resolved for key=${key}`)
    return { result }
  }

  const queuedSizeBefore = queue.size
  const pendingBefore = queue.pending
  consola.info(`📥 [${name}] enqueue key=${key} (size=${queuedSizeBefore}, pending=${pendingBefore})`)

  // Schedule the job to run sequentially within the per-task queue
  const jobPromise: Promise<T> = (async () => {
    try {
      return await queue.add(async () => {
        const start = Date.now()
        consola.start(`🚀 [${name}] start key=${key}`)
        try {
          if (name === 'transform:image') {
            const res = await (transformImage as any)(payload)
            consola.success(`✅ [${name}] done key=${key} in ${Date.now() - start}ms`)
            return res
          }
          if (name === 'transform:video') {
            const res = await (transformVideo as any)(payload)
            consola.success(`✅ [${name}] done key=${key} in ${Date.now() - start}ms`)
            return res
          }
          throw new Error(`No task name ${name} found`)
        } catch (err) {
          consola.error(`❌ [${name}] failed key=${key} in ${Date.now() - start}ms`)
          throw err
        }
      })
    } finally {
      inflight.delete(key)
      consola.info(`🧹 [${name}] cleanup key=${key} (size=${queue.size}, pending=${queue.pending})`)
    }
  })()

  inflight.set(key, jobPromise as Promise<any>)
  const result = await jobPromise
  return { result }
}
