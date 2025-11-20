const MODIFIER_SEP = /[&,]/g
const MODIFIER_VAL_SEP = /[:=_]/

const NORMALIZED_KEYS: Record<string, string> = {
  f: 'format',
  w: 'width',
  h: 'height',
  s: 'resize',
  pos: 'position',
  q: 'quality',
  a: 'animated',
  c: 'codec',
  kernel: 'kernel',
  fit: 'fit',
  trim: 'trim',
  extend: 'extend',
  b: 'background',
  extract: 'extract',
  crop: 'crop',
  rotate: 'rotate',
  enlarge: 'enlarge',
  flip: 'flip',
  flop: 'flop',
  sharpen: 'sharpen',
  median: 'median',
  blur: 'blur',
  gamma: 'gamma',
  negate: 'negate',
  normalize: 'normalize',
  threshold: 'threshold',
  tint: 'tint',
  grayscale: 'grayscale',
  flatten: 'flatten',
  modulate: 'modulate',
}

function safeString(input: string) {
  return JSON.stringify(input).replace(/^"|"$/g, '').replace(/\\+/g, '\\').replace(/\\"/g, '"')
}

export default function (modifiersString: string): Record<string, string> {
  const raw: Record<string, string> = Object.create(null)

  if (!modifiersString || modifiersString === '_') {
    return raw
  }

  for (const p of modifiersString.split(MODIFIER_SEP)) {
    if (!p) continue

    const [key, ...values] = p.split(MODIFIER_VAL_SEP)
    if (!key) continue

    const safeKey = safeString(key)
    raw[safeKey] = values.map((v) => safeString(v)).join('_')
  }

  // Build a new object with normalized keys
  const modifiers: Record<string, string> = Object.create(null)

  for (const [rawKey, value] of Object.entries(raw)) {
    const normalizedKey = NORMALIZED_KEYS[rawKey] || rawKey

    // Prefer explicit long-form if both exist in input
    if (normalizedKey in modifiers) {
      continue
    }

    modifiers[normalizedKey] = value
  }

  return modifiers
}
