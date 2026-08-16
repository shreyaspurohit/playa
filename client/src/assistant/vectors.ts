// Pure int8 vector (de)quantization for semantic search (ADR 21). The build
// (embed.mjs, Node) quantizes vectors and the browser decodes them — the two
// must agree, so the logic is kept import-free and unit-tested here.

/** Quantize a unit-norm float embedding to int8 (×127, clamped to [-128,127]). */
export function quantizeToInt8(vec: ArrayLike<number>): Int8Array {
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const x = Math.round(vec[i] * 127);
    q[i] = x > 127 ? 127 : x < -128 ? -128 : x;
  }
  return q;
}

/** Decode base64 of `count` concatenated int8 rows (each `dim` long) back to
 *  unit-scale floats. Mirror of the build-time quantization. */
export function decodeVectors(dataB64: string, dim: number, count: number): Float32Array[] {
  const bin = atob(dataB64);
  const bytes = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = (bin.charCodeAt(i) << 24) >> 24;  // → signed
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const v = new Float32Array(dim);
    for (let j = 0; j < dim; j++) v[j] = bytes[i * dim + j] / 127;
    out.push(v);
  }
  return out;
}
