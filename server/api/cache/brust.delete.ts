export default defineEventHandler(async (event) => {
  const body = await readBody<string[]>(event)
  const r2 = useStorage('r2')
  const fs = useStorage('fs')

  for await (const item of body) {
    await r2.removeItem(item)
    await fs.removeItem(item)
  }

  return { status: 'OK' }
})
