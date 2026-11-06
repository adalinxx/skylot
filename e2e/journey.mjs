// The whole Skylot loop on a private local Lattice: one node mines Nexus,
// Nexus/testnet and a Skylot chain launched from chain/spec.json with the
// built policy; a second node follows the Skylot chain and reads the same
// city. Players sign the way the Lattice wallet signs.
//
// Alice claims a lot and raises it (each floor burns double the last); Bob's
// late claim of the same lot is refused and explained; Bob buys the building
// at Alice's price and keeps its skyline rank; Alice can no longer build on it;
// Bob uploads a brand with an image and a link; the policy refuses an
// underpaid burn, an SVG brand and a write to someone else's brand.
//
//   LATTICE=<lattice-node>/.build/release/lattice node e2e/journey.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as sdk from "../app/vendor/lattice-sdk.js";
import * as S from "../client/skylot.mjs";
import { tip, view, volumeLoader } from "../client/state.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const SPEC = JSON.parse(readFileSync(here("../chain/spec.json"), "utf8"));
const MODULE = here("../chain/skylot_policy.wasm");
const CHAIN = ["Nexus", "testnet", "skylot-e2e"];
const FEE = 1n;

function host(name, ports) {
  const root = mkdtempSync(`${tmpdir()}/skylot-${name}-`);
  const lattice = (...args) => execFileSync(process.env.LATTICE, [...args, "--root", root], { encoding: "utf8" });
  const configure = (change) => {
    const file = `${root}/lattice.json`, t = JSON.parse(readFileSync(file, "utf8"));
    change(t); writeFileSync(file, JSON.stringify(t, null, 2));
  };
  return { name, root, lattice, configure, ...ports, url: `http://127.0.0.1:${ports.publicRead}` };
}
const A = host("a", { listen: 25131, rpc: 29390, publicRead: 29391 });
const B = host("b", { listen: 25132, rpc: 29392, publicRead: 29393 });

const account = () => sdk.accountFromPrivateKey(sdk.generatePrivateKey());
const [miner, faucet, alice, bob] = [account(), account(), account(), account()];

async function until(label, condition, seconds = Number(process.env.E2E_SECONDS ?? 300)) {
  const deadline = Date.now() + seconds * 1000;
  let failure;
  for (;;) {
    const value = await condition().catch((e) => void (failure = e));
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`, { cause: failure });
    await new Promise((r) => setTimeout(r, 500));
  }
}
async function api(node, path, chain = CHAIN) {
  const url = new URL(path, node.url); url.searchParams.set("chainPath", chain.join("/"));
  const r = await fetch(url, { cache: "no-store" });
  return r.ok ? r.json() : undefined;
}
const accountState = (who, node = A) => api(node, `/api/state/account/${who.address ?? who}`);
const balance = async (who, node = A) => BigInt((await accountState(who, node))?.balance ?? 0);
const volumes = (node) => new sdk.VolumeClient(new sdk.HTTPVolumeTransport(`${node.url}/volumes`, { chainPath: CHAIN }));
async function state(node = A) {
  const client = volumes(node), { generalStateCID } = await tip(sdk, node.url, CHAIN, client);
  return view(volumeLoader(client, sdk.decodeDagCbor), generalStateCID);
}
const lotAt = async (x, y, node = A) => (await S.city(await state(node))).lots.get(`${x},${y}`);
const height = async () => Number((await api(A, "/api/chain/info"))?.height ?? 0);

/** Sign `act` by `who` as the wallet would, and submit. Resolves to { ok, text }. */
async function send(who, act) {
  const request = S.writeRequest(CHAIN, act, FEE);
  const body = S.transaction({
    owner: who.address, actions: request.actions,
    payments: (request.payments ?? []).map(({ to, amount }) => ({ to, amount: BigInt(amount) })),
    fee: FEE, nonce: BigInt((await accountState(who))?.nonce ?? 0), chainPath: request.chainPath,
  });
  const { publicKey, signature } = sdk.signTransactionBody(body, who.privateKey);
  const r = await fetch(new URL("/transactions", A.url), { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sdk.transactionPayload({ [publicKey]: signature }, body)) });
  return { ok: r.ok, text: await r.text() };
}
async function lands(label, who, act, landed) {
  const r = await send(who, act);
  assert.ok(r.ok, `${label}: ${r.text}`);
  await until(label, landed);
  console.log(`✓ ${label}`);
}
/** A write the chain must not apply: refused at submit, or never lands within 4 blocks. */
async function refused(label, who, act, applied) {
  const r = await send(who, act);
  if (r.ok) {
    const h0 = await height();
    await until(`${label} (blocks pass)`, async () => (await height()) >= h0 + 4, 120);
    assert.ok(!(await applied()), `${label}: the chain applied it`);
  }
  console.log(`✓ refused: ${label}${r.ok ? "" : ` (${r.text.slice(0, 80)})`}`);
}

const pay = (to, amount) => ({ actions: [], payments: [{ to: to.address, amount }] });
const pngPixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

try {
  A.lattice("init");
  A.configure((t) => {
    Object.assign(t, { listen: A.listen, rpc: A.rpc, publicRead: A.publicRead, webSocket: 0, publicSubmit: true, minRelayFee: Number(FEE) });
    t.publicReadExpensiveRate = 1000; t.peers = [];
    t.mine = { worker: "cpu", workers: 1, batchSize: 100000 };
  });
  A.lattice("child", "create", "Nexus/testnet");
  writeFileSync(`${A.root}/skylot.json`, JSON.stringify(SPEC));
  A.lattice("child", "create", CHAIN.join("/"), "--spec", `${A.root}/skylot.json`, "--policy-module", MODULE, "--premine-to", faucet.address);
  A.configure((t) => { t.mine.recipients = { Nexus: miner.address, "Nexus/testnet": miner.address, [CHAIN.join("/")]: miner.address }; });
  A.lattice("up");
  A.lattice("mine", "start");
  await until("the Skylot genesis pays the faucet", async () => (await balance(faucet)) > 0n);
  console.log(`✓ launched ${CHAIN.join("/")}; faucet holds ${await balance(faucet)}`);

  await lands("the faucet pays Alice 3000", faucet, pay(alice, 3000n), async () => (await balance(alice)) === 3000n);
  await lands("the faucet pays Bob 3000", faucet, pay(bob, 3000n), async () => (await balance(bob)) === 3000n);

  const [x, y] = [7, 7], price = S.lotPrice(x, y);
  await refused("Alice underpays the lot's burn", alice,
    { ...S.claim(x, y, alice.address, 500n, "glass", Date.now()), payments: [{ to: S.BURN, amount: price - 1n }] },
    async () => !!(await lotAt(x, y)));
  await lands(`Alice claims (${x},${y}), burning ${price}`, alice, S.claim(x, y, alice.address, 500n, "glass", Date.now()),
    async () => (await lotAt(x, y))?.owner === alice.address);
  assert.equal(await balance(S.BURN), price);

  for (const want of [2, 3]) {
    const lot = await lotAt(x, y), cost = S.floorCost(lot.bld.floors);
    await lands(`Alice raises to ${want} floors, burning ${cost}`, alice, S.raise(lot, Date.now()),
      async () => (await lotAt(x, y))?.bld?.floors === want);
  }
  assert.equal(await balance(S.BURN), price + 14n + 28n);

  await refused("Bob claims the lot Alice already holds", bob, S.claim(x, y, bob.address, 900n, "brick", Date.now()),
    async () => (await lotAt(x, y))?.owner === bob.address);
  const why = await S.explain(await state(), S.claim(x, y, bob.address, 900n, "brick", Date.now()), await balance(bob));
  assert.match(why, /claimed this lot first/);

  const before = await lotAt(x, y), aliceBefore = await balance(alice);
  await lands("Bob buys Alice's building at her price, 500", bob, S.buy(before, bob.address, 2000n),
    async () => (await lotAt(x, y))?.owner === bob.address);
  const after = await lotAt(x, y);
  assert.equal(after.bld.floors, 3); assert.equal(after.bld.at, before.bld.at);   // the skyline rank comes along
  assert.equal(await balance(alice), aliceBefore + 500n);

  // She names the lot as it is now (Bob's), so only the policy can refuse it.
  await refused("Alice raises the building she sold", alice, S.raise(after, Date.now()),
    async () => (await lotAt(x, y))?.bld?.floors === 4);

  await lands("Bob uploads a brand with an image and a link", bob,
    S.setBrand(bob.address, { name: "Bob's Bikes", image: pngPixel, link: "https://example.com/bikes" }),
    async () => (await S.city(await state())).brands.get(bob.address)?.link === "https://example.com/bikes");
  await refused("Alice writes Bob's brand", alice,
    { actions: [{ key: S.brandKey(bob.address), oldValue: await (await state()).get(S.brandKey(bob.address)), newValue: '{"name":"pwned"}' }], payments: [] },
    async () => (await S.city(await state())).brands.get(bob.address)?.name === "pwned");
  await refused("Alice sets an SVG brand", alice,
    { actions: [{ key: S.brandKey(alice.address), newValue: '{"name":"x","image":"data:image/svg+xml;base64,PHN2Zy8+"}' }], payments: [] },
    async () => (await (await state()).get(S.brandKey(alice.address))) !== undefined);

  // A second node follows the chain and reads the same city.
  B.lattice("init");
  B.configure((t) => {
    Object.assign(t, { listen: B.listen, rpc: B.rpc, publicRead: B.publicRead, webSocket: 0, hostedChains: ["Nexus/testnet", CHAIN.join("/")] });
    t.publicReadExpensiveRate = 1000;
    t.peers = [`${A.lattice("identity").match(/([0-9a-f]{64})@/)[1]}@127.0.0.1:${A.listen}`];
  });
  B.lattice("up");
  const seen = await until("a second node reads Bob's building", async () => (await lotAt(x, y, B))?.owner === bob.address && (await lotAt(x, y, B)));
  assert.equal(seen.bld.floors, 3);
  console.log("✓ a second node serves the same city");
  console.log("\nE2E PASSED");
} finally {
  for (const node of [B, A]) { try { node.lattice("mine", "stop"); } catch {} try { node.lattice("down"); } catch {} }
}
