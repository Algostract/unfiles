export default async function (args: string) {
  const mods: Record<string, string | number | boolean> = {}
  // Normalize separators: support ",", URL-encoded commas, and "&"
  const normalized = (args || '').replace(/%2C/gi, ',').replace(/&/g, ',').replace(/\s+/g, '') // strip spaces just in case
  const tokens = normalized.split(',').filter(Boolean)

  for (const t of tokens) {
    if (t.startsWith('s_')) {
      const m = t.slice(2).match(/^(\d+)?x(\d+)?$/)
      if (m) {
        const [, w, h] = m
        if (w) mods.w = w
        if (h) mods.h = h
      }
      continue
    }
    const [rawKey, ...rest] = t.split('_')
    const value = rest.join('_') // keep underscores in values like pos_attention
    let key = rawKey

    if (rawKey === 'f') key = 'format'
    else if (rawKey === 'q' || rawKey === 'quality') key = 'quality'
    else if (rawKey === 'pos') key = 'position'
    else if (rawKey === 'b' || rawKey === 'background') key = 'background'
    else if (rawKey === 'w') key = 'w'
    else if (rawKey === 'h') key = 'h'
    else if (rawKey === 'fit') key = 'fit'
    else if (rawKey === 'dpr') key = 'dpr'
    else if (rawKey === 'c') key = 'codec'

    // Booleans (no value) → set to "true"
    if (!value && ['flip', 'flop', 'grayscale', 'flatten', 'normalize', 'animated', 'negate'].includes(key)) {
      mods[key] = 'true'
      continue
    }
    if (value) mods[key] = value
  }
  return mods
}
