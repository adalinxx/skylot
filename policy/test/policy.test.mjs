// Runs the built policy module the way the Lattice host does (host.mjs).
// Bodies are encoded by the SDK, whose encoding is pinned to Lattice's vectors.
//
//   cargo build --release --target wasm32-unknown-unknown
//   node --test test/
//
// LATTICE_SDK overrides the SDK entry (default: the sibling lattice-sdk
// checkout's packages/sdk/dist/index.js). With CONTEXT_DIR set, every context
// is recorded with its verdict so host-check can replay it.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { context as hostContext, moduleBytes, validate } from "./host.mjs";

const SDK = process.env.LATTICE_SDK ?? new URL("../../../lattice-sdk/packages/sdk/dist/index.js", import.meta.url).href;
const { encodeTransactionBody, cidV1DagCbor, encodeDagCbor } = await import(SDK);

const rules = JSON.parse(readFileSync(new URL("../../chain/rules.json", import.meta.url), "utf8"));
const utf8 = (text) => new TextEncoder().encode(text);

const PATH = ["Nexus", "testnet", "skylot-000000"];
const NOW = 1_800_000_000_000n;
const BURN = rules.burn;
const WINDOW = BigInt(rules.timeWindowMs);
const ALICE = cidV1DagCbor(utf8("alice"));
const BOB = cidV1DagCbor(utf8("bob"));
const CAROL = cidV1DagCbor(utf8("carol"));

const contextDirectory = process.env.CONTEXT_DIR;
if (contextDirectory) mkdirSync(contextDirectory, { recursive: true });
let recorded = 0;

function run(bytes) {
  const accepted = validate(bytes);
  if (contextDirectory) {
    const name = `${String(recorded++).padStart(4, "0")}-${accepted ? "accept" : "reject"}.bin`;
    writeFileSync(`${contextDirectory}/${name}`, bytes);
  }
  return accepted;
}

function body(actions, signers, accountActions = []) {
  return encodeTransactionBody({
    accountActions,
    actions,
    depositActions: [],
    receiptActions: [],
    withdrawalActions: [],
    signers,
    nonce: 7n,
    chainPath: PATH,
  }).bytes;
}

const context = (bytes, options = {}) => hostContext(bytes, { path: PATH, timestamp: NOW, ...options });

/** A transaction: who signs, its writes, and its coin. `.ok(at)` is the verdict. */
class Tx {
  constructor(signers) {
    this.signers = signers;
    this.actions = [];
    this.coin = [];
  }
  write(key, oldValue, newValue) {
    const action = { key };
    if (oldValue !== undefined) action.oldValue = oldValue;
    if (newValue !== undefined) action.newValue = newValue;
    this.actions.push(action);
    return this;
  }
  pay(owner, delta) {
    this.coin.push({ owner, delta: BigInt(delta) });
    return this;
  }
  burn(amount) {
    return this.pay(BURN, amount);
  }
  ok(timestamp = NOW) {
    return run(context(body(this.actions, this.signers, this.coin), { timestamp }));
  }
}
const by = (...signers) => new Tx(signers);
const lot = (holder, price) => `${holder}@${price}`;
const bld = (floors, style, at) => `${floors} ${style} ${at}`;
const claim = (who, key, burn) =>
  by(who)
    .write(`lot/${key}`, undefined, lot(who, 500))
    .write(`bld/${key}`, undefined, bld(1, "glass", NOW))
    .burn(burn);
const raise = (old, next, burn, signer = ALICE) =>
  by(signer).write("lot/1,1", lot(signer, 20), lot(signer, 20)).write("bld/1,1", old, next).burn(burn);

test("the burn address is the dag-cbor CIDv1 of sha256(\"skylot:burn\")", () => {
  assert.equal(cidV1DagCbor(utf8("skylot:burn")), BURN);
});

test("every lot in rules.json costs exactly its price, and streets can't be claimed", () => {
  let lots = 0;
  for (let y = 0; y < rules.grid; y++) {
    for (let x = 0; x < rules.grid; x++) {
      const price = rules.lotPrices[`${x},${y}`];
      const street = x % rules.streetEvery === 0 || y % rules.streetEvery === 0;
      assert.equal(price === undefined, street, `${x},${y}`);
      if (street) {
        assert.ok(!claim(ALICE, `${x},${y}`, 1000).ok(), `street ${x},${y}`);
        continue;
      }
      lots++;
      assert.ok(claim(ALICE, `${x},${y}`, price).ok(), `${x},${y}`);
      assert.ok(!claim(ALICE, `${x},${y}`, price - 1).ok(), `${x},${y} underpaid`);
    }
  }
  assert.equal(lots, 144);
  assert.equal(Object.keys(rules.lotPrices).length, 144);
});

test("a claim burns its price and builds one floor, signed by the new holder", () => {
  assert.ok(claim(ALICE, "1,1", 20).ok());
  assert.ok(claim(ALICE, "1,1", 12).burn(8).ok());
  assert.ok(!by(ALICE).write("lot/1,1", undefined, lot(ALICE, 9)).write("bld/1,1", undefined, bld(1, "glass", NOW)).ok());
  assert.ok(!by(ALICE).write("lot/1,1", undefined, lot(ALICE, 9)).burn(20).ok());
  assert.ok(
    !by(ALICE).write("lot/1,1", undefined, lot(ALICE, 9)).write("bld/1,1", undefined, bld(2, "glass", NOW)).burn(34).ok(),
  );
  assert.ok(
    !by(BOB).write("lot/1,1", undefined, lot(ALICE, 9)).write("bld/1,1", undefined, bld(1, "glass", NOW)).burn(20).ok(),
  );
  // Two claims burn the sum.
  const two = (burn) =>
    by(ALICE)
      .write("lot/1,1", undefined, lot(ALICE, 9))
      .write("bld/1,1", undefined, bld(1, "glass", NOW))
      .write("lot/7,7", undefined, lot(ALICE, 9))
      .write("bld/7,7", undefined, bld(1, "stone", NOW))
      .burn(burn);
  assert.ok(!two(103).ok());
  assert.ok(two(104).ok());
});

test("lot keys and values have one spelling", () => {
  for (const key of ["01,1", "1,01", "1", "1,", ",1", "", "1,1,1", "-1,1", "+1,1", "17,1", "16,16", " 1,1"]) {
    assert.ok(!claim(ALICE, key, 1000).ok(), key);
  }
  for (const value of [ALICE, `${ALICE}@0`, `${ALICE}@01`, `${ALICE}@`, `${ALICE}@5@6`, "@5", "alice@5", `${ALICE}@-1`, ""]) {
    assert.ok(
      !by(ALICE).write("lot/1,1", undefined, value).write("bld/1,1", undefined, bld(1, "glass", NOW)).burn(20).ok(),
      JSON.stringify(value),
    );
  }
});

test("the holder reprices or gives away a lot, but never deletes it", () => {
  assert.ok(by(ALICE).write("lot/1,1", lot(ALICE, 20), lot(ALICE, 10_000)).ok());
  assert.ok(by(ALICE).write("lot/1,1", lot(ALICE, 20), lot(BOB, 1)).ok());
  assert.ok(!by(ALICE).write("lot/1,1", lot(ALICE, 20)).ok());
  assert.ok(!by(ALICE).write("lot/1,1", lot(ALICE, 20), ALICE).ok());
});

test("anyone else takes a lot by paying its holder the listed price", () => {
  const buy = (paid) => by(BOB).write("lot/1,1", lot(ALICE, 50), lot(BOB, 900)).pay(BOB, -paid).pay(ALICE, paid);
  assert.ok(buy(50).ok());
  assert.ok(!buy(49).ok());
  assert.ok(!by(BOB).write("lot/1,1", lot(ALICE, 50), lot(BOB, 900)).ok());
  assert.ok(!by(BOB).write("lot/1,1", lot(ALICE, 50), lot(BOB, 900)).burn(50).ok());
  // Several lots from one holder are paid for together.
  const many = (paid) =>
    by(BOB)
      .write("lot/1,1", lot(ALICE, 50), lot(BOB, 9))
      .write("lot/2,1", lot(ALICE, 30), lot(BOB, 9))
      .write("lot/3,1", lot(CAROL, 7), lot(BOB, 9))
      .pay(ALICE, paid)
      .pay(CAROL, 7);
  assert.ok(many(80).ok());
  assert.ok(!many(79).ok());
  // The buyer raises the bought building in the same transaction.
  const build = (burn) =>
    by(BOB)
      .write("lot/1,1", lot(ALICE, 50), lot(BOB, 9))
      .write("bld/1,1", bld(3, "glass", 5), bld(4, "brick", NOW))
      .pay(ALICE, 50)
      .burn(burn);
  assert.ok(build(56).ok());
  assert.ok(!build(55).ok());
});

test("a lot held by the burn address is bought on top of every burn", () => {
  const tx = (burned) =>
    by(BOB)
      .write("lot/1,1", lot(BURN, 30), lot(BOB, 9))
      .write("lot/2,1", undefined, lot(BOB, 9))
      .write("bld/2,1", undefined, bld(1, "glass", NOW))
      .burn(burned);
  assert.ok(tx(52).ok());
  assert.ok(!tx(30).ok());
});

test("each new floor burns 14 × 2^(floors − 1), one floor at a time", () => {
  assert.ok(raise(bld(1, "glass", 5), bld(2, "glass", NOW), 14).ok());
  assert.ok(!raise(bld(1, "glass", 5), bld(2, "glass", NOW), 13).ok());
  assert.ok(raise(bld(2, "glass", 5), bld(3, "glass", NOW), 28).ok());
  assert.ok(raise(bld(11, "glass", 5), bld(12, "glass", NOW), 14_336).ok());
  assert.ok(raise(bld(29, "glass", 5), bld(30, "glass", NOW), 14 * 2 ** 28).ok());
  assert.ok(!raise(bld(29, "glass", 5), bld(30, "glass", NOW), 14 * 2 ** 28 - 1).ok());
  assert.ok(!raise(bld(30, "glass", 5), bld(31, "glass", NOW), 10n ** 15n).ok());
  assert.ok(!raise(bld(1, "glass", 5), bld(3, "glass", NOW), 10n ** 15n).ok());
  assert.ok(!raise(bld(3, "glass", 5), bld(2, "glass", NOW), 0).ok());
  assert.ok(!by(ALICE).write("lot/1,1", lot(ALICE, 20), lot(ALICE, 20)).write("bld/1,1", bld(3, "glass", 5)).ok());
});

test("a restyle is free and keeps its time", () => {
  assert.ok(raise(bld(5, "glass", 5), bld(5, "brick", 5), 0).ok());
  assert.ok(!raise(bld(5, "glass", 5), bld(5, "brick", NOW), 0).ok());
  assert.ok(!raise(bld(5, "glass", NOW), bld(6, "glass", NOW), 10n ** 9n).ok());
});

test("a changed time is within ten minutes of the block's timestamp", () => {
  const at = (at) => raise(bld(1, "glass", 5), bld(2, "glass", at), 14);
  assert.ok(at(NOW - WINDOW).ok());
  assert.ok(at(NOW + WINDOW).ok());
  assert.ok(!at(NOW - WINDOW - 1n).ok());
  assert.ok(!at(NOW + WINDOW + 1n).ok());
  assert.ok(at(NOW).ok(NOW + WINDOW));
  assert.ok(!at(NOW).ok(NOW + WINDOW + 1n));
});

test("only the lot's signing holder builds", () => {
  const up = [bld(1, "glass", 5), bld(2, "glass", NOW)];
  assert.ok(!by(ALICE).write("bld/1,1", ...up).burn(14).ok());
  assert.ok(!by(BOB).write("lot/1,1", lot(ALICE, 20), lot(ALICE, 20)).write("bld/1,1", ...up).pay(ALICE, 20).burn(14).ok());
  assert.ok(!by(ALICE).write("lot/1,1", lot(ALICE, 20), lot(BOB, 20)).write("bld/1,1", ...up).burn(14).ok());
  assert.ok(by(ALICE, BOB).write("lot/1,1", lot(ALICE, 20), lot(BOB, 20)).write("bld/1,1", ...up).burn(14).ok());
  // A building is created only with its lot.
  assert.ok(!by(ALICE).write("lot/1,1", lot(ALICE, 20), lot(ALICE, 20)).write("bld/1,1", undefined, bld(1, "glass", NOW)).ok());
});

test("building values have one spelling", () => {
  for (const value of ["2 glass", "2  glass 1", "02 glass 1", "0 glass 1", "2 wood 1", "2 Glass 1", "2 glass 01", "2 glass 1 x", ""]) {
    const spelled = value.replace(/1$/, String(NOW));
    assert.ok(!raise(bld(1, "glass", 5), spelled, 10n ** 9n).ok(), JSON.stringify(spelled));
  }
});

test("users write their own records: brands up to 32 KB and never SVG, the rest up to 4 KB", () => {
  const mine = (rest, value) => by(ALICE).write(`user/${ALICE}/${rest}`, undefined, value);
  assert.ok(mine("note", "hello").ok());
  assert.ok(mine("note", "x".repeat(4096)).ok());
  assert.ok(!mine("note", "x".repeat(4097)).ok());
  assert.ok(by(ALICE).write(`user/${ALICE}/note`, "hello").ok());
  assert.ok(mine("brand", JSON.stringify({ name: "Acme", art: "rocket", image: "data:image/png;base64,AAAA" })).ok());
  assert.ok(mine("brand", "x".repeat(32768)).ok());
  assert.ok(!mine("brand", "x".repeat(32769)).ok());
  assert.ok(!mine("brand", JSON.stringify({ name: "Acme", image: "data:image/svg+xml;base64,AAAA" })).ok());
  assert.ok(!mine("brand", '{"image":"data:image\\/svg+xml,<svg/>"}').ok());
  assert.ok(!mine("brand", "IMAGE/SVG").ok());
  assert.ok(!by(ALICE).write(`user/${BOB}/note`, undefined, "x").ok());
  assert.ok(!by(ALICE).write(`user/${BOB}/brand`, undefined, "{}").ok());
  assert.ok(!by(ALICE).write(`user/${BOB}/note`, "x").ok());
});

test("keys outside the four shapes are refused; coin passes untouched", () => {
  for (const key of [ALICE, "lot", "lots/1,1", "bld", "user", `user/${ALICE}`, `user/${ALICE}/`, "user//x", `own/${ALICE}/1`]) {
    assert.ok(!by(ALICE).write(key, undefined, "x").burn(1000).ok(), key);
  }
  assert.ok(by(ALICE).ok());
  assert.ok(by(ALICE).pay(ALICE, -1000).pay(BOB, 998).ok());
});

test("a malformed or unknown context is refused", () => {
  const good = body(claim(ALICE, "1,1", 20).actions, [ALICE], [{ owner: BURN, delta: 20n }]);
  assert.ok(run(context(good)));
  assert.ok(!run(context(good, { version: 1 })));
  assert.ok(!run(context(undefined)));
  assert.ok(!run(context(good.slice(0, good.length - 3))));
  assert.ok(!run(context(good).slice(0, 40)));
  assert.ok(!run(context(good).slice(0, 26)));
  assert.ok(!run(new Uint8Array(0)));
});

// The committed module and the spec that names it.
const chain = (name) => new URL(`../../chain/${name}`, import.meta.url);

/**
 * A policy module's CID, as Lattice derives it (cashew's `WasmPolicyModule`
 * node): the DAG-CBOR map `{bytes: <base64 text of the module>}`. host-check
 * prints the same CID from Lattice itself.
 */
const moduleCID = (bytes) => cidV1DagCbor(encodeDagCbor({ bytes: Buffer.from(bytes).toString("base64") }));

test("chain/spec.json names the committed module, which is this build", () => {
  const committed = readFileSync(chain("skylot_policy.wasm"));
  assert.ok(Buffer.compare(committed, moduleBytes) === 0, "chain/skylot_policy.wasm is not the module under test");
  const spec = JSON.parse(readFileSync(chain("spec.json"), "utf8"));
  assert.deepEqual(spec.wasmPolicies, [
    {
      moduleCID: moduleCID(committed),
      abiVersion: 1,
      scope: "transaction",
      entrypoint: "lattice_validate_transaction",
    },
  ]);
  assert.equal(spec.targetBlockTime, 10000);
  assert.equal(spec.initialReward, 1000);
  assert.equal(spec.halvingInterval, 210000);
  assert.equal(spec.halfLife, 100);
  assert.equal(spec.premine, 10000);
  assert.equal(spec.maxNumberOfTransactionsPerBlock, 1000);
  assert.equal(spec.maxStateGrowth, 1000000);
  assert.equal(spec.maxBlockSize, 1000000);
});
