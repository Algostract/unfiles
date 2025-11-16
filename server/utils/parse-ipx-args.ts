const MODIFIER_SEP = /[&,]/g
const MODIFIER_VAL_SEP = /[:=_]/

function safeString(input: string) {
  return JSON.stringify(input).replace(/^"|"$/g, '').replace(/\\+/g, '\\').replace(/\\"/g, '"')
}

/**
 * Parse a modifiers string (e.g. "w_300,h_200,f_webp")
 * into a Record<string, string>.
 *
 * Examples:
 *  "w_300,h_200" => { w: "300", h: "200" }
 *  "f_auto"      => { f: "auto" }
 *  "_"           => {}
 */
export default function (modifiersString: string): Record<string, string> {
  const modifiers: Record<string, string> = Object.create(null)

  // Same behavior as in your handler:
  // "_" means "no modifiers"
  if (!modifiersString || modifiersString === '_') {
    return modifiers
  }

  for (const p of modifiersString.split(MODIFIER_SEP)) {
    if (!p) continue

    const [key, ...values] = p.split(MODIFIER_VAL_SEP)
    if (!key) continue

    modifiers[safeString(key)] = values.map((v) => safeString(v)).join('_')
  }

  return modifiers
}
