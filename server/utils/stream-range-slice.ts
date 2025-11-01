// [start, end) byte range; pass only start to read to EOF
export default function (start: number, end = Infinity) {
  return new TransformStream<Uint8Array, Uint8Array>({
    start() {
      this._o = 0 // bytes seen so far
      this._r = end - start // bytes remaining to emit
    },
    transform(chunk, controller) {
      if (this._r <= 0) return
      const next = this._o + chunk.byteLength
      if (next <= start) {
        this._o = next
        return
      }
      const s = Math.max(0, start - this._o)
      const e = Math.min(chunk.byteLength, s + this._r)
      controller.enqueue(chunk.subarray(s, e))
      this._r -= e - s
      this._o = next
    },
  })
}
