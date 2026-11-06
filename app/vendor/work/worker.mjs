// src/web/work/sha256.ts
var K = Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var w = new Uint32Array(64);
function compress(state, view, at) {
  for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4);
  for (let i = 16; i < 64; i++) {
    const a2 = w[i - 15], b2 = w[i - 2];
    const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
    const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
    w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
    const t1 = h + S1 + (e & f ^ ~e & g) + K[i] + w[i] | 0;
    const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
    const t2 = S0 + (a & b ^ a & c ^ b & c) | 0;
    h = g;
    g = f;
    f = e;
    e = d + t1 | 0;
    d = c;
    c = b;
    b = a;
    a = t1 + t2 | 0;
  }
  state[0] += a;
  state[1] += b;
  state[2] += c;
  state[3] += d;
  state[4] += e;
  state[5] += f;
  state[6] += g;
  state[7] += h;
}
var bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
function prepare(prefixHex, targetHex) {
  const prefix = bytes(prefixHex);
  const target = new Uint32Array(8);
  const targetView = new DataView(bytes(targetHex.padStart(64, "0")).buffer);
  for (let i = 0; i < 8; i++) target[i] = targetView.getUint32(i * 4);
  const midstate = Uint32Array.from([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const whole = prefix.length - prefix.length % 64;
  const prefixView = new DataView(prefix.buffer);
  for (let at = 0; at < whole; at += 64) compress(midstate, prefixView, at);
  const tail = prefix.length - whole;
  const blocks = tail + 8 + 9 <= 64 ? 1 : 2;
  const last = new Uint8Array(blocks * 64);
  last.set(prefix.subarray(whole));
  last[tail + 8] = 128;
  const lastView = new DataView(last.buffer);
  const bits = (prefix.length + 8) * 8;
  lastView.setUint32(last.length - 8, Math.floor(bits / 2 ** 32));
  lastView.setUint32(last.length - 4, bits >>> 0);
  return { midstate, last, tail, blocks, target };
}

// src/web/work/worker.ts
onmessage = ({ data: { prefixHex, targetHex, start, count } }) => {
  const { midstate, last, tail, blocks, target } = prepare(prefixHex, targetHex);
  const lastView = new DataView(last.buffer);
  const state = new Uint32Array(8);
  const first = BigInt(start);
  let hi = Number(first >> 32n);
  let lo = Number(first & 0xffffffffn);
  let hashes = 0;
  for (let left = Number(count); left > 0; left--) {
    lastView.setUint32(tail, hi);
    lastView.setUint32(tail + 4, lo);
    state.set(midstate);
    for (let b = 0; b < blocks; b++) compress(state, lastView, b * 64);
    for (let i = 0; i < 8; i++) {
      if (state[i] === target[i] && i < 7) continue;
      if (state[i] <= target[i]) postMessage({ share: String(BigInt(hi) << 32n | BigInt(lo)) });
      break;
    }
    if (++lo === 2 ** 32) {
      lo = 0;
      hi = hi + 1 >>> 0;
    }
    if (++hashes === 1 << 18) {
      postMessage({ hashes });
      hashes = 0;
    }
  }
  postMessage({ hashes, done: true });
};
