// The real page against a real local chain. One node mines Nexus,
// Nexus/testnet and a Skylot chain from chain/spec.json; the repo is served
// over http; headless Chrome opens the page in chain mode with a stand-in for
// Selfhold for Chrome that signs real transactions with a throwaway key.
// A fee sponsor (lattice-sponsor --payout-at) runs beside the node. The
// player starts with no coin: the test plays through the page's own code,
// connect, let the page's grinder earn coin until the sponsor pays it out,
// then buy an empty lot, raise it (the listed price rises too), and upload a
// brand with a picture and a link, checking each against the chain.
// Screenshots go to $SHOTS.
//
//   LATTICE=<lattice-node>/.build/debug/lattice LATTICE_SPONSOR=<lattice-sponsor> SHOTS=<dir> node e2e/page.mjs
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as sdk from "../app/vendor/lattice-sdk.js";
import * as S from "../client/skylot.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHAIN = ["Nexus", "testnet", "skylot-page"];
const SHOTS = process.env.SHOTS ?? tmpdir();
const ports = { listen: 25141, rpc: 29490, publicRead: 29491, sponsor: 29492, web: 28765, cdp: 9533 };
const sponsorURL = `http://127.0.0.1:${ports.sponsor}`, PAYOUT_AT = 200n;
const nodeURL = `http://127.0.0.1:${ports.publicRead}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const root = mkdtempSync(`${tmpdir()}/skylot-page-`);
const lattice = (...args) => execFileSync(process.env.LATTICE, [...args, "--root", root], { encoding: "utf8" });
const configure = (change) => { const f = `${root}/lattice.json`, t = JSON.parse(readFileSync(f, "utf8")); change(t); writeFileSync(f, JSON.stringify(t, null, 2)); };
const account = () => sdk.accountFromPrivateKey(sdk.generatePrivateKey());
const [miner, faucet, player] = [account(), account(), account()];
let sponsorChild;

async function until(label, condition, seconds = 300) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) { const v = await condition().catch(() => undefined); if (v) return v; if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`); await sleep(500); }
}
async function api(path) { const u = new URL(path, nodeURL); u.searchParams.set("chainPath", CHAIN.join("/")); const r = await fetch(u, { cache: "no-store" }); return r.ok ? r.json() : undefined; }
const balance = async (who) => BigInt((await api(`/api/state/account/${who}`))?.balance ?? 0);

// The repo over http (the page's modules can't load from file://).
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml" };
const web = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try { const body = readFileSync(join(ROOT, path === "/" ? "index.html" : path)); res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(ports.web);

// Stand-in for Selfhold for Chrome: the extension's provider API, signing with the throwaway key.
const STAND_IN = `
(() => {
  const KEY = ${JSON.stringify(sdk.bytesToHex(player.privateKey))}, ADDRESS = ${JSON.stringify(player.address)};
  let connected = false;
  window.lattice = {
    isLatticeWallet: true,
    connect: async () => { connected = true; return ADDRESS; },
    address: async () => (connected ? ADDRESS : null),
    disconnect: async () => { connected = false; },
    signMessage: async () => { throw new Error('not in this test'); },
    writeRecords: async (params) => {
      const sdk = await import('/app/vendor/lattice-sdk.js'), S = await import('/client/skylot.mjs');
      const node = ${JSON.stringify(nodeURL)}, path = params.chainPath.join('/');
      const get = async (p) => (await fetch(node + p + (p.includes('?') ? '&' : '?') + 'chainPath=' + encodeURIComponent(path), { cache: 'no-store' })).json();
      const info = await get('/api/chain/info'), acct = await get('/api/state/account/' + ADDRESS);
      const fee = BigInt(params.fee ?? info.minRelayFee ?? 1), nonce = BigInt(acct.nonce ?? 0);
      const body = S.transaction({ owner: ADDRESS, actions: params.actions, payments: (params.payments ?? []).map((p) => ({ to: p.to, amount: BigInt(p.amount) })), fee, nonce, chainPath: params.chainPath });
      const { publicKey, signature } = sdk.signTransactionBody(body, sdk.hexToBytes(KEY));
      const r = await fetch(node + '/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sdk.transactionPayload({ [publicKey]: signature }, body)) });
      const text = await r.text();
      if (!r.ok) throw new Error(text);
      let cid; try { cid = JSON.parse(text).transactionCID; } catch {}
      window.__writes = (window.__writes || 0) + 1;
      return { transactionCID: cid ?? 'unknown', nonce: String(nonce), host: node };
    },
  };
  dispatchEvent(new Event('lattice#initialized'));
})();`;

// Minimal CDP driver.
async function chrome() {
  const proc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${ports.cdp}`, `--user-data-dir=${mkdtempSync(`${tmpdir()}/skylot-cdp-`)}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
  let targets; for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${ports.cdp}/json`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const run = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate failed"); return r.result?.result?.value; };
  const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const f = join(SHOTS, `${name}.png`); writeFileSync(f, Buffer.from(r.result.data, "base64")); return f; };
  return { send, run, shot, errors, close: () => { ws.close(); proc.kill(); } };
}

let page;
try {
  lattice("init");
  configure((t) => { Object.assign(t, { listen: ports.listen, rpc: ports.rpc, publicRead: ports.publicRead, webSocket: 0, publicSubmit: true, minRelayFee: 1 });
    t.publicReadExpensiveRate = 1000; t.peers = []; t.mine = { worker: "cpu", workers: 1, batchSize: 100000 }; });
  lattice("child", "create", "Nexus/testnet");
  writeFileSync(`${root}/skylot.json`, readFileSync(join(ROOT, "chain/spec.json")));
  lattice("child", "create", CHAIN.join("/"), "--spec", `${root}/skylot.json`, "--policy-module", join(ROOT, "chain/skylot_policy.wasm"), "--premine-to", faucet.address);
  const keyFile = `${root}/sponsor-key.json`;
  execFileSync(process.env.LATTICE, ["key", "generate", "--out", keyFile]);
  const sponsor = JSON.parse(readFileSync(keyFile, "utf8"));
  // The chain's rewards are the sponsor's float, as on testnet.
  configure((t) => { t.mine.recipients = { Nexus: miner.address, "Nexus/testnet": miner.address, [CHAIN.join("/")]: sponsor.address }; });
  lattice("up"); lattice("mine", "start");
  await until("genesis", async () => (await balance(faucet.address)) > 0n);
  await until("the sponsor's float", async () => (await balance(sponsor.address)) > 3000n);
  const log = openSync(`${root}/sponsor.log`, "a");
  sponsorChild = spawn(process.env.LATTICE_SPONSOR || join(dirname(process.env.LATTICE), "lattice-sponsor"), ["--node", `http://127.0.0.1:${ports.rpc}`,
    "--cookie-file", `${root}/chains/Nexus/.cookie`, "--key", keyFile, "--share-work", "2^16", "--fee", "1",
    "--payout-at", String(PAYOUT_AT), "--storage-file", `${root}/sponsor-storage.json`, "--port", String(ports.sponsor)], { stdio: ["ignore", log, log] });
  await until("the sponsor's terms", async () => (await (await fetch(`${sponsorURL}/terms`)).json()).payoutAt === String(PAYOUT_AT), 60);
  assert.equal(await balance(player.address), 0n);
  console.log("✓ chain and sponsor up; the player holds 0 coin");

  page = await chrome();
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: STAND_IN });
  await page.send("Page.navigate", { url: `http://127.0.0.1:${ports.web}/index.html?node=${encodeURIComponent(nodeURL)}&chain=${CHAIN.join("/")}&sponsor=${encodeURIComponent(sponsorURL)}` });
  await sleep(4000);
  await page.run("SkylotChain.ready");
  // Connect through the page's own button.
  const clicked = await page.run(`(() => { const b = [...document.querySelectorAll('button')].find(b => /Connect with Selfhold/.test(b.textContent)); if (b) b.click(); return !!b; })()`);
  assert.ok(clicked, "no Connect with Selfhold button");
  console.log("✓ connected through Selfhold's client");
  // Grinding is off until the player switches it on; then the page grinds for
  // the player's address (headless: on processor workers).
  assert.ok(await page.run("!CHAIN.grinder"), "no grinding before the player asks");
  await until("the chip offers grinding", async () => /switch on/.test(await page.run("document.getElementById('grindRate').textContent")), 60);
  await page.run("(() => { const t = document.getElementById('grindToggle'); t.checked = true; t.onchange({ target: t }); })()");
  await until("the grinder runs", () => page.run("!!(CHAIN.grind && CHAIN.grind.rate > 0)"), 60);
  console.log(`✓ the page grinds: ${await page.run("document.getElementById('grindRate').textContent")}`);
  await until("the sponsor pays the player out", async () => (await balance(player.address)) >= PAYOUT_AT, 180);
  const earned = await balance(player.address);
  await until("the HUD shows the paid coin", async () => (await page.run("document.getElementById('coin').textContent")) === String(earned), 60);
  console.log(`✓ the sponsor paid the player ${earned} for the page's work; the HUD shows it`);
  assert.equal(await page.run("localStorage.getItem('curio.grind')"), "on", "the choice is remembered");
  // A write pauses grinding while it is in flight, and it resumes after.
  await page.run("(() => { CHAIN.writing = 1; chainGrind(); })()");
  assert.ok(await page.run("!CHAIN.grinder"), "paused while Selfhold writes");
  await page.run("(() => { CHAIN.writing = 0; chainGrind(); })()");
  assert.ok(await page.run("!!CHAIN.grinder"), "resumed after");
  // Off through the chip's switch, so the balances below are the writes' alone.
  await page.run("(() => { const t = document.getElementById('grindToggle'); t.checked = false; t.onchange({ target: t }); })()");
  assert.ok(await page.run("!CHAIN.grinder"));

  const [x, y] = [7, 7];
  await page.run(`(() => { state.selected = [${x}, ${y}]; buy(lot(${x}, ${y})); })()`);
  await until("claim lands on chain", async () => (await S.city(await chainView())).lots.get(`${x},${y}`)?.owner === player.address);
  await until("page shows the building as yours", () => page.run(`lot(${x},${y}).owner === 'you' && lot(${x},${y}).floors === 1 && !lot(${x},${y}).pending`), 60);   // the page takes no new write while one is pending
  console.log(`✓ bought (${x},${y}) through the page; the chain and the page agree`);

  const listed = (await S.city(await chainView())).lots.get(`${x},${y}`).price;
  await page.run(`raise(lot(${x}, ${y}))`);
  await until("raise lands", async () => (await S.city(await chainView())).lots.get(`${x},${y}`)?.bld?.floors === 2);
  const after = (await S.city(await chainView())).lots.get(`${x},${y}`);
  assert.equal(after.price, listed + 2n * 14n, "a raise relists at the floor's cost × 2 higher");
  await until("page shows 2 floors", () => page.run(`lot(${x},${y}).floors === 2`), 60);
  console.log(`✓ raised to 2 floors through the page; price ${listed} → ${after.price}`);

  // A 16×16 orange square as the uploaded picture, made in the page like an upload would be.
  await page.run(`(async () => { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d');
    g.fillStyle = '#ff7a00'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#ffffff'; g.fillRect(4, 4, 8, 8);
    const image = c.toDataURL('image/png');
    return SkylotChain.perform('brand', { brand: { name: 'Orange Box', image, link: 'https://example.com/orange' } }); })()`);
  await until("brand lands", async () => (await S.city(await chainView())).brands.get(player.address)?.link === "https://example.com/orange");
  console.log("✓ brand with picture and link written through the page");

  await sleep(6000);
  await page.run(`(() => { state.selected = [${x}, ${y}]; renderPanel(); const p = iso(${x}, ${y}); cam.z = 2; })()`);
  await page.run(`(() => { const p = iso(${x}, ${y}); cam.x += (innerWidth - 344) / 2 - p.x; cam.y += innerHeight / 2 + 60 - p.y; })()`);
  await sleep(2500);
  console.log("screenshot:", await page.shot("chain-page-building"));
  const text = await page.run("document.getElementById('panel').innerText");
  assert.match(text, /example\.com/, "the panel shows the link's domain");
  assert.equal(page.errors.length, 0, `uncaught errors: ${page.errors.join(" | ")}`);
  console.log("✓ panel shows the link's domain; no uncaught page errors\n\nPAGE E2E PASSED");
} finally {
  page?.close(); web.close(); sponsorChild?.kill();
  try { lattice("mine", "stop"); } catch {} try { lattice("down"); } catch {}
}

async function chainView() {
  const { tip, view, volumeLoader } = await import("../client/state.mjs");
  const client = new sdk.VolumeClient(new sdk.HTTPVolumeTransport(`${nodeURL}/volumes`, { chainPath: CHAIN }));
  const { generalStateCID } = await tip(sdk, nodeURL, CHAIN, client);
  return view(volumeLoader(client, sdk.decodeDagCbor), generalStateCID);
}
