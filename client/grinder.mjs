// Grinds coin for the player: asks the fee sponsor for payout work naming
// the player's address (POST /work {chain, payTo}), hashes it on this
// device's graphics chip through WebGPU or, without one, on processor cores,
// and hands each share back (POST /shares). The sponsor credits the address
// and pays its earnings out in coin once they reach its payout threshold
// (GET /earnings). Nothing here signs anything: work only ever pays the
// address it names.
//
// The hashing is Selfhold's (app/vendor/work/, from adalinxx/selfhold-wallet).

const GPU_BATCH = 1 << 24;   // nonces per GPU dispatch: about a share's work
const CPU_SLICE = 1 << 20;   // nonces per worker message

/**
 * grind({ sponsor, chain, address, onStatus }) → { stop() }
 * onStatus({ rate, device, earned, payoutAt, shares, error }) as it goes:
 * rate in hashes a second, device "GPU" or "CPU ×n", earned in whole coins
 * not yet paid out.
 */
export function grind({ sponsor, chain, address, onStatus, cores }) {
  let stopped = false;
  const status = { rate: 0, device: '', earned: 0n, payoutAt: null, shares: 0, error: null };
  const tell = () => { try { onStatus?.({ ...status }); } catch {} };
  const post = async (path, body) => {
    const r = await fetch(`${sponsor}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(text || `HTTP ${r.status}`), { status: r.status });
    return JSON.parse(text);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let hashed = 0, since = performance.now();
  const count = (n) => {
    hashed += n;
    const now = performance.now();
    if (now - since >= 2000) { status.rate = hashed * 1000 / (now - since); hashed = 0; since = now; tell(); }
  };

  /**
   * Hand a share back; false when the work is gone and new work is needed.
   * The sponsor's front limits how fast one client hands shares back (429):
   * the share waits and goes again, so a fast chip simply waits on it.
   */
  async function share(work, nonce) {
    for (let tries = 0; !stopped; tries++) {
      try {
        const { credit } = await post('shares', { assignment: work.assignment, nonce: String(nonce) });
        status.earned = BigInt(credit); status.shares++; status.error = null; tell();
        return true;
      } catch (e) {
        if (e.status === 429 && tries < 30) { await sleep(400 + 200 * Math.min(tries, 5)); continue; }
        if ([400, 404, 410, 429, 503].includes(e.status)) return false;   // stale, sold out or busy: ask again
        throw Object.assign(e, { sponsor: true });
      }
    }
    return false;
  }

  async function earnings() {
    try {
      const r = await fetch(`${sponsor}/earnings?chain=${encodeURIComponent(chain)}&address=${address}`, { cache: 'no-store' });
      if (r.ok) { const e = await r.json(); status.earned = BigInt(e.earned); status.payoutAt = BigInt(e.payoutAt); tell(); }
    } catch {}
  }

  // One piece of work on the GPU, until it runs out or goes stale.
  async function onGpu(gpu, work) {
    const job = gpu.job(work.prefixHex, work.shareTarget);
    try {
      let start = BigInt(work.startNonce);
      const end = start + BigInt(work.count);
      for (; start < end && !stopped; start += BigInt(GPU_BATCH)) {
        const n = Number(end - start < BigInt(GPU_BATCH) ? end - start : BigInt(GPU_BATCH));
        let found;
        try { found = await job.run(start, n); } catch (e) { throw Object.assign(e, { gpu: true }); }
        count(n);
        for (const nonce of found) if (!(await share(work, nonce))) return;
        await sleep(0);   // let the page draw
      }
    } finally { job.close(); }
  }

  // One piece of work across `n` processor workers. Once it is stale (or
  // failed), its workers finish their slice and take no more, and a share
  // they still find is dropped: it belongs to work the sponsor has let go.
  function onCpu(workers, work) {
    return new Promise((resolve, reject) => {
      let next = BigInt(work.startNonce), live = 0, stale = false, failed = null;
      const end = next + BigInt(work.count);
      const settle = () => { if (live === 0) failed ? reject(failed) : resolve(); };
      const feed = (worker) => {
        if (stopped || stale || next >= end) { settle(); return; }
        const n = end - next < BigInt(CPU_SLICE) ? end - next : BigInt(CPU_SLICE);
        live++; worker.postMessage({ prefixHex: work.prefixHex, targetHex: work.shareTarget, start: String(next), count: String(n) });
        next += n;
      };
      for (const worker of workers) {
        worker.onmessage = async ({ data }) => {
          if (data.hashes) count(data.hashes);
          if (data.share && !stale && !stopped) {
            try { if (!(await share(work, BigInt(data.share)))) stale = true; } catch (e) { stale = true; failed ??= e; }
          }
          if (data.done) { live--; feed(worker); }
        };
        worker.onerror = (e) => { stale = true; failed ??= e; live = Math.max(0, live - 1); settle(); };
        feed(worker);
      }
    });
  }

  (async () => {
    const { gpuGrinder, gpuFailed } = await import('../app/vendor/work/gpu.mjs');
    let gpu = await gpuGrinder();
    let workers = null;
    await earnings();
    let lastEarnings = performance.now();
    while (!stopped) {
      let work;
      try { work = await post('work', { chain, payTo: address }); status.error = null; }
      catch (e) {
        status.error = e.status === 404 ? 'This sponsor pays no coin for work.' : e.status === 503 ? 'The sponsor is busy; trying again.' : `The sponsor isn't answering (${e.message.slice(0, 80)}).`;
        status.rate = 0; tell();
        if (e.status === 404) return;
        await sleep(e.status === 503 ? 5_000 : 15_000); continue;
      }
      try {
        if (gpu) {
          status.device = 'GPU';
          try { await onGpu(gpu, work); }
          catch (e) { if (!e.gpu) throw e; gpuFailed(); gpu = null; }   // a driver that can't run it: the processor from now on
        } else {
          const n = Math.max(1, cores ?? Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
          workers ??= Array.from({ length: n }, () => new Worker(new URL('../app/vendor/work/worker.mjs', import.meta.url), { type: 'module' }));
          status.device = `CPU ×${n}`;
          await onCpu(workers, work);
        }
      } catch (e) { status.error = String(e.message ?? e).slice(0, 120); tell(); await sleep(5_000); }
      if (performance.now() - lastEarnings > 20_000) { await earnings(); lastEarnings = performance.now(); }
    }
    for (const w of workers ?? []) w.terminate();
  })();

  return { stop() { stopped = true; status.rate = 0; tell(); } };
}
