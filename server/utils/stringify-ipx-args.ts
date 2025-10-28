export default function (args: Record<string, string | number | boolean>) {
  return Object.entries(args)
    .map(([k, v]) => `${k}_${String(v)}`)
    .join(',')
}
