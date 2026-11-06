// Skylot played with no coin, as on mainnet: a fee sponsor (lattice-sponsor)
// beside the node pays each write's fee and burn in exchange for shares of
// its block template that the player's device grinds, the way Selfhold's
// window does. Nobody hands out coin.
//
// Carol starts with 0 coin. She claims a lot, raises it and buys Dave's
// building, every burn and payment paid for with work; a write past the
// sponsor's most-pay is refused by the sponsor, never half-applied.
//
// Erin grinds for coin instead (payout work, as the page's grinder does):
// her shares earn her address, the sponsor pays her out in coin once she
// reaches its --payout-at, and she spends it in a plain coin write, as
// Selfhold for Chrome would.
//
//   LATTICE=<lattice-node>/.build/release/lattice \
//   LATTICE_SPONSOR=<lattice-sponsor>/.build/debug/lattice-sponsor node e2e/sponsor.mjs
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as sdk from "../app/vendor/lattice-sdk.js";
import * as S from "../client/skylot.mjs";
import { tip, view, volumeLoader } from "../client/state.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const SPEC = JSON.parse(readFileSync(here("../chain/spec.json"), "utf8"));
const MODULE = here("../chain/skylot_policy.wasm");
const CHAIN = ["Nexus", "testnet", "skylot-e2e"];
const [listen, rpc, publicRead, sponsorPort] = [25151, 29500, 29501, 29502];
const node = `http://127.0.0.1:${publicRead}`, sponsorURL = `http://127.0.0.1:${sponsorPort}`;
const MOST_PAY = 600n, PAYOUT_AT = 100n;

const root = mkdtempSync(`${tmpdir()}/skylot-sponsor-`);
const lattice = (...args) => execFileSync(process.env.LATTICE, [...args, "--root", root], { encoding: "utf8" });
const configure = (change) => { const f = `${root}/lattice.json`, t = JSON.parse(readFileSync(f, "utf8")); change(t); writeFileSync(f, JSON.stringify(t, null, 2)); };
const account = () => sdk.accountFromPrivateKey(sdk.generatePrivateKey());
const [carol, dave, erin] = [account(), account(), account()];
let sponsor, sponsorChild;

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
async function api(path) {
  const url = new URL(path, node); url.searchParams.set("chainPath", CHAIN.join("/"));
  const r = await fetch(url, { cache: "no-store" });
  return r.ok ? r.json() : undefined;
}
const accountState = (who) => api(`/api/state/account/${who.address ?? who}`);
const balance = async (who) => BigInt((await accountState(who))?.balance ?? 0);
async function state() {
  const client = new sdk.VolumeClient(new sdk.HTTPVolumeTransport(`${node}/volumes`, { chainPath: CHAIN }));
  const { generalStateCID } = await tip(sdk, node, CHAIN, client);
  return view(volumeLoader(client, sdk.decodeDagCbor), generalStateCID);
}
const lotAt = async (x, y) => (await S.city(await state())).lots.get(`${x},${y}`);

// ---- the sponsor, as Selfhold's window uses it

async function ask(path, body) {
  const r = await fetch(`${sponsorURL}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`${path}: ${r.status} ${text}`), { status: r.status });
  return JSON.parse(text);
}
/** Nonces whose SHA-256 over the prefix and the nonce (8 bytes, big-endian) is at or under the share target. */
function* shares(work) {
  const prefix = Buffer.from(work.prefixHex, "hex"), target = BigInt(`0x${work.shareTarget}`);
  const input = Buffer.alloc(prefix.length + 8); prefix.copy(input);
  for (let n = BigInt(work.startNonce), end = n + BigInt(work.count); n < end; n++) {
    input.writeBigUInt64BE(n, prefix.length);
    if (BigInt(`0x${createHash("sha256").update(input).digest("hex")}`) <= target) yield n;
  }
}
const tokens = new Map();
let ground = 0;
/** Grind until the sponsor co-signs `draft` (fee 0), paying its fee and `pay` coins of its payments. */
async function sponsored(who, draft, pay) {
  const wire = sdk.transactionPayload({}, draft).transaction.body;
  for (let round = 0; ; round++) {
    if (tokens.has(who.address)) {
      try {
        const answer = await ask("sponsor", { client: tokens.get(who.address), transaction: { signatures: {}, body: wire }, pay: String(pay) });
        const body = { ...answer.transaction.body, nonce: BigInt(answer.transaction.body.nonce),
          accountActions: answer.transaction.body.accountActions.map((a) => ({ owner: a.owner, delta: BigInt(a.delta) })) };
        // The sponsor added only its own signer and account actions: Selfhold's window checks the same.
        assert.deepEqual(body.signers, [who.address, sponsor.address]);
        assert.deepEqual(body.actions, draft.actions);
        assert.deepEqual(body.accountActions.slice(0, draft.accountActions.length), draft.accountActions);
        assert.ok(body.accountActions.slice(draft.accountActions.length).every((a) => a.owner === sponsor.address || (a.owner === who.address && a.delta > 0n)));
        return { body, signatures: answer.transaction.signatures };
      } catch (error) { if (error.status !== 402) throw error; }
    }
    if (round > 30) throw new Error("the sponsor took none of this work");
    const work = await ask("work", { ...(tokens.has(who.address) && { client: tokens.get(who.address) }), chain: CHAIN.join("/"), pay: String(pay) });
    tokens.set(who.address, work.client);
    let found = 0;
    for (const nonce of shares(work)) {
      try { await ask("shares", { assignment: work.assignment, nonce: String(nonce) }); ground++; }
      catch (error) { if (error.status === 400 || error.status === 410) break; throw error; }
      if (++found >= Number(work.sharesForFee)) break;
    }
  }
}
/** `act` by `who`, its fee and payments paid by work; the node's answer. */
async function send(who, act) {
  const request = S.writeRequest(CHAIN, act, 0n);
  const payments = (request.payments ?? []).map(({ to, amount }) => ({ to, amount: BigInt(amount) }));
  const pay = payments.reduce((s, p) => s + p.amount, 0n);
  const draft = S.transaction({ owner: who.address, actions: request.actions, payments, fee: 0n,
    nonce: BigInt((await accountState(who))?.nonce ?? 0), chainPath: request.chainPath });
  const { body, signatures } = await sponsored(who, draft, pay);
  const mine = sdk.signTransactionBody(body, who.privateKey);
  const r = await fetch(`${node}/transactions`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sdk.transactionPayload({ ...signatures, [mine.publicKey]: mine.signature }, body)) });
  return { ok: r.ok, text: await r.text() };
}
async function lands(label, who, act, landed) {
  const before = ground, r = await send(who, act);
  assert.ok(r.ok, `${label}: ${r.text}`);
  await until(label, landed);
  console.log(`✓ ${label} (${ground - before} shares ground)`);
}

try {
  lattice("init");
  configure((t) => {
    Object.assign(t, { listen, rpc, publicRead, webSocket: 0, publicSubmit: true, minRelayFee: 1 });
    t.publicReadExpensiveRate = 1000; t.peers = [];
    t.mine = { worker: "cpu", workers: 1, batchSize: 100000 };
  });
  lattice("child", "create", "Nexus/testnet");
  writeFileSync(`${root}/skylot.json`, JSON.stringify(SPEC));
  const keyFile = `${root}/sponsor-key.json`;
  execFileSync(process.env.LATTICE, ["key", "generate", "--out", keyFile]);
  sponsor = JSON.parse(readFileSync(keyFile, "utf8"));
  // The premine goes to a key nobody uses here: no one is handed coin.
  lattice("child", "create", CHAIN.join("/"), "--spec", `${root}/skylot.json`, "--policy-module", MODULE, "--premine-to", account().address);
  // The node's own mining pays the sponsor, which is the float it pays fees and burns from.
  configure((t) => { t.mine.recipients = { Nexus: account().address, "Nexus/testnet": account().address, [CHAIN.join("/")]: sponsor.address }; });
  lattice("up");
  lattice("mine", "start");
  await until("the sponsor's float", async () => (await balance(sponsor)) > 3000n);
  const log = openSync(`${root}/sponsor.log`, "a");
  const bin = process.env.LATTICE_SPONSOR || join(dirname(process.env.LATTICE), "lattice-sponsor");
  sponsorChild = spawn(bin, ["--node", `http://127.0.0.1:${rpc}`, "--cookie-file", `${root}/chains/Nexus/.cookie`, "--key", keyFile,
    "--share-work", "2^12", "--fee", "1", "--most-pay", String(MOST_PAY), "--payout-at", String(PAYOUT_AT),
    "--storage-file", `${root}/sponsor-storage.json`, "--port", String(sponsorPort)], { stdio: ["ignore", log, log] });
  await until("the sponsor prices Skylot", async () => (await ask("work", { chain: CHAIN.join("/") }), true), 120);
  assert.equal(await balance(carol), 0n);
  assert.equal(await balance(dave), 0n);
  console.log(`✓ Skylot up; the sponsor pays for work, at most ${MOST_PAY} a write; Carol and Dave hold 0`);

  const burned = async () => balance(S.BURN);
  const [x, y] = [7, 7], price = S.lotPrice(x, y);
  await lands(`Carol claims (${x},${y}) with work, burning ${price}`, carol, S.claim(x, y, carol.address, 300n, "glass", Date.now()),
    async () => (await lotAt(x, y))?.owner === carol.address);
  assert.equal(await burned(), price);
  for (const want of [2, 3]) {
    const lot = await lotAt(x, y), cost = S.floorCost(lot.bld.floors);
    await lands(`Carol raises to ${want} floors with work, burning ${cost}`, carol, S.raise(lot, Date.now()),
      async () => (await lotAt(x, y))?.bld?.floors === want);
  }
  assert.equal(await burned(), price + 14n + 28n);
  assert.equal(await balance(carol), 0n, "work paid every burn exactly; Carol's balance never moved");

  const [dx, dy] = [6, 7];
  await lands(`Dave claims (${dx},${dy}) with work`, dave, S.claim(dx, dy, dave.address, 150n, "brick", Date.now()),
    async () => (await lotAt(dx, dy))?.owner === dave.address);
  await lands("Carol buys Dave's building with work, paying him 150", carol, S.buy(await lotAt(dx, dy), carol.address, 400n),
    async () => (await lotAt(dx, dy))?.owner === carol.address);
  assert.equal(await balance(dave), 150n, "the seller is paid in real coin");

  // A floor past the sponsor's most-pay: the sponsor won't price it, so nothing is sent.
  const big = { ...S.raise(await lotAt(x, y), Date.now()), payments: [{ to: S.BURN, amount: MOST_PAY + 1n }] };
  await assert.rejects(() => send(carol, big), /at most/);
  console.log(`✓ refused by the sponsor: a burn of ${MOST_PAY + 1n}, past its most-pay`);

  // ---- grinding for coin: payout work names Erin's address, no token or key needed
  assert.equal(await balance(erin), 0n);
  const t0 = Date.now();
  let earned = 0n, payoutShares = 0;
  while (earned < PAYOUT_AT) {
    const work = await ask("work", { chain: CHAIN.join("/"), payTo: erin.address });
    assert.equal(work.sharesForFee, "0", "payout work buys no fee");
    for (const nonce of shares(work)) {
      try { earned = BigInt((await ask("shares", { assignment: work.assignment, nonce: String(nonce) })).credit); payoutShares++; }
      catch (error) { if (error.status === 400 || error.status === 410 || error.status === 503) break; throw error; }
      if (earned >= PAYOUT_AT) break;
    }
  }
  const status = await (await fetch(`${sponsorURL}/earnings?chain=${CHAIN.join("/")}&address=${erin.address}`)).json();
  assert.equal(status.payoutAt, String(PAYOUT_AT));
  await until("the sponsor pays Erin out", async () => (await balance(erin)) >= PAYOUT_AT);
  const paid = await balance(erin);
  console.log(`✓ Erin ground ${payoutShares} shares for coin and was paid ${paid} (${Math.round((Date.now() - t0) / 1000)}s)`);
  const left = BigInt((await (await fetch(`${sponsorURL}/earnings?chain=${CHAIN.join("/")}&address=${erin.address}`)).json()).earned);
  assert.ok(left < PAYOUT_AT, "what was paid left her earnings");
  assert.equal((await (await fetch(`${sponsorURL}/terms`)).json()).payoutAt, String(PAYOUT_AT));

  // She spends it with no sponsor at all: a plain coin write, fee included.
  const [ex, ey] = [5, 7], ePrice = S.lotPrice(ex, ey);
  assert.ok(paid >= ePrice + 1n, `a payout of ${paid} covers lot (${ex},${ey}) at ${ePrice}`);
  const request = S.writeRequest(CHAIN, S.claim(ex, ey, erin.address, 200n, "stone", Date.now()), 1n);
  const body = S.transaction({ owner: erin.address, actions: request.actions,
    payments: request.payments.map(({ to, amount }) => ({ to, amount: BigInt(amount) })), fee: 1n,
    nonce: BigInt((await accountState(erin))?.nonce ?? 0), chainPath: request.chainPath });
  const signed = sdk.signTransactionBody(body, erin.privateKey);
  const r = await fetch(`${node}/transactions`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sdk.transactionPayload({ [signed.publicKey]: signed.signature }, body)) });
  assert.ok(r.ok, await r.text());
  await until("Erin's claim lands", async () => (await lotAt(ex, ey))?.owner === erin.address);
  assert.equal(await balance(erin), paid - ePrice - 1n);
  console.log(`✓ Erin claims (${ex},${ey}) with her ground coin, burning ${ePrice}`);

  console.log("\nSPONSOR E2E PASSED");
} finally {
  sponsorChild?.kill();
  try { lattice("down"); } catch {}
}
