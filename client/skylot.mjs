// Skylot's records on its chain: the values, the reads and the writes, as
// docs/chain.md specifies them. The chain's policy checks every write; this
// module builds writes the policy accepts, and reads state defensively,
// because anyone can write anything the policy lets through.
import RULES from "../chain/rules.json" with { type: "json" };

export { RULES };
export const BURN = RULES.burn;
export const STYLES = ["glass", "brick", "stone"];

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const ADDRESS = /^bafyrei[a-z2-7]{52}$/;

/** True when `x,y` is a lot: inside the grid and on no street. */
export const isLot = (x, y) =>
  Number.isInteger(x) && Number.isInteger(y) && x > 0 && y > 0 && x < RULES.grid && y < RULES.grid &&
  x % RULES.streetEvery !== 0 && y % RULES.streetEvery !== 0;
export const lotKey = (x, y) => `lot/${x},${y}`;
export const bldKey = (x, y) => `bld/${x},${y}`;
export const brandKey = (who) => `user/${who}/brand`;

/** The burn to claim the lot at x,y. */
export function lotPrice(x, y) {
  const price = RULES.lotPrices[`${x},${y}`];
  if (price === undefined) throw new Error(`(${x},${y}) is not a lot`);
  return BigInt(price);
}
/** The burn to raise a building from `floors` to `floors + 1`: 14, 28, 56 … (doubling). */
export function floorCost(floors) {
  if (!Number.isInteger(floors) || floors < 1 || floors >= RULES.maxFloors) throw new Error(`no floor above ${floors}`);
  return BigInt(RULES.floorBase) * BigInt(RULES.floorGrowth) ** BigInt(floors - 1);
}

// ---- values

export function parseLot(value) {
  const m = typeof value === "string" && /^([a-z0-9]+)@([0-9]+)$/.exec(value);
  if (!m || !ADDRESS.test(m[1]) || !DECIMAL.test(m[2]) || m[2] === "0") return undefined;
  return { owner: m[1], price: BigInt(m[2]), value };
}
export const lotValue = (owner, price) => {
  if (typeof price !== "bigint" || price < 1n || price >= 2n ** 64n) throw new Error(`bad price: ${price}`);
  return `${owner}@${price}`;
};
export function parseBld(value) {
  const m = typeof value === "string" && /^([0-9]+) ([a-z]+) ([0-9]+)$/.exec(value);
  if (!m || !DECIMAL.test(m[1]) || !DECIMAL.test(m[3]) || !STYLES.includes(m[2])) return undefined;
  const floors = Number(m[1]);
  if (floors < 1 || floors > RULES.maxFloors) return undefined;
  return { floors, style: m[2], at: Number(m[3]), value };
}
export const bldValue = (floors, style, at) => `${floors} ${style} ${Math.round(at)}`;

/**
 * A brand as anyone may have written it, reduced to what the page will draw:
 * a name, pixel art, an inline PNG/JPEG/WebP image, and an https link.
 * Anything else is dropped. The page still decodes the image into a bitmap
 * before drawing it, and shows the link's domain before opening it.
 */
export function parseBrand(value) {
  let raw;
  try { raw = JSON.parse(value); } catch { return undefined; }
  if (!raw || typeof raw !== "object") return undefined;
  const brand = { name: typeof raw.name === "string" ? raw.name.slice(0, 24) : "" };
  if (typeof raw.art === "string" && /^[0-9a-zA-Z_-]{1,2048}$/.test(raw.art)) brand.art = raw.art;
  if (typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color)) brand.color = raw.color;
  if (typeof raw.image === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.image)) brand.image = raw.image;
  const link = safeLink(raw.link);
  if (link) brand.link = link;
  return brand;
}
/** An https URL with a host and no credentials, or undefined. */
export function safeLink(text) {
  if (typeof text !== "string" || text.length > 300) return undefined;
  let url;
  try { url = new URL(text); } catch { return undefined; }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return undefined;
  return url.href;
}
export function brandValue({ name, art, color, image, link }) {
  const value = JSON.stringify({ name, ...(art && { art }), ...(color && { color }), ...(image && { image }), ...(link && { link: safeLink(link) }) });
  if (new TextEncoder().encode(value).length > RULES.brandMaxBytes) throw new Error("Brand is too large: use a smaller image");
  if (value.includes("image/svg")) throw new Error("SVG images aren't allowed");
  return value;
}

// ---- reads (state is a view from state.mjs: { get, list })

/** The whole city: every lot with its owner, price and building, and each owner's brand. */
export async function city(state) {
  const lots = new Map();
  for await (const [key, value] of state.list("lot/")) {
    const m = /^lot\/([0-9]+),([0-9]+)$/.exec(key), lot = parseLot(value);
    if (!m || !lot) continue;
    const x = Number(m[1]), y = Number(m[2]);
    if (isLot(x, y)) lots.set(`${x},${y}`, { x, y, ...lot, bld: undefined });
  }
  for await (const [key, value] of state.list("bld/")) {
    const m = /^bld\/([0-9]+),([0-9]+)$/.exec(key), lot = m && lots.get(`${m[1]},${m[2]}`);
    if (lot) lot.bld = parseBld(value);
  }
  const brands = new Map();
  for (const owner of new Set([...lots.values()].map((l) => l.owner))) {
    const value = await state.get(brandKey(owner));
    if (value !== undefined) { const b = parseBrand(value); if (b) brands.set(owner, b); }
  }
  return { lots, brands };
}

// ---- writes: each returns { actions, payments } for one act, named against
// what the writer read, so a stale view is refused, never misapplied.

/** Claim an empty lot: burn its price, list it at `price`, and put up a 1-floor building. */
export function claim(x, y, owner, price, style, now) {
  return {
    actions: [
      { key: lotKey(x, y), newValue: lotValue(owner, price) },
      { key: bldKey(x, y), newValue: bldValue(1, style, now) },
    ],
    payments: [{ to: BURN, amount: lotPrice(x, y) }],
  };
}
/**
 * Add a floor: burns the next floor's cost. Names the lot (unchanged, or at
 * a new `price`) to prove ownership; the owner may relist in the same write.
 */
export function raise(lot, now, price) {
  const { bld } = lot;
  return {
    actions: [
      { key: lotKey(lot.x, lot.y), oldValue: lot.value, newValue: price === undefined ? lot.value : lotValue(lot.owner, price) },
      { key: bldKey(lot.x, lot.y), oldValue: bld.value, newValue: bldValue(bld.floors + 1, bld.style, now) },
    ],
    payments: [{ to: BURN, amount: floorCost(bld.floors) }],
  };
}
/** Change a building's style, at no cost. */
export const restyle = (lot, style) => ({
  actions: [
    { key: lotKey(lot.x, lot.y), oldValue: lot.value, newValue: lot.value },
    { key: bldKey(lot.x, lot.y), oldValue: lot.bld.value, newValue: bldValue(lot.bld.floors, style, lot.bld.at) },
  ],
  payments: [],
});
/** The owner sets a new price. */
export const reprice = (lot, price) => ({
  actions: [{ key: lotKey(lot.x, lot.y), oldValue: lot.value, newValue: lotValue(lot.owner, price) }],
  payments: [],
});
/** `buyer` takes the lot at its listed price, and lists it at `price`. */
export function buy(lot, buyer, price) {
  if (lot.owner === buyer) throw new Error("You already own it");
  return {
    actions: [{ key: lotKey(lot.x, lot.y), oldValue: lot.value, newValue: lotValue(buyer, price) }],
    payments: [{ to: lot.owner, amount: lot.price }],
  };
}
/** Write `who`'s brand; `old` is the value read (undefined if none). */
export const setBrand = (who, brand, old) => ({
  actions: [{ key: brandKey(who), ...(old !== undefined && { oldValue: old }), newValue: brandValue(brand) }],
  payments: [],
});

/**
 * A transaction body for `actions` signed by `owner`, who pays the fee and
 * each payment: the body the Lattice wallet builds for `writeRecords`.
 */
export function transaction({ owner, actions, payments = [], fee, nonce, chainPath }) {
  const credits = new Map();
  for (const { to, amount } of payments) credits.set(to, (credits.get(to) ?? 0n) + amount);
  const debit = fee + [...credits.values()].reduce((sum, amount) => sum + amount, 0n);
  return {
    accountActions: [
      ...(debit > 0n ? [{ owner, delta: -debit }] : []),
      ...[...credits].map(([to, amount]) => ({ owner: to, delta: amount })),
    ],
    actions,
    depositActions: [],
    receiptActions: [],
    withdrawalActions: [],
    signers: [owner],
    nonce,
    chainPath: [...chainPath],
  };
}

/** The `window.lattice.writeRecords` request for one act. */
export function writeRequest(chainPath, { actions, payments = [] }, fee = 1n) {
  const credits = new Map();
  for (const { to, amount } of payments) credits.set(to, (credits.get(to) ?? 0n) + amount);
  return {
    chainPath: [...chainPath],
    actions,
    ...(credits.size > 0 && { payments: [...credits].map(([to, amount]) => ({ to, amount: String(amount) })) }),
    fee: String(fee),
  };
}

/**
 * Why a write didn't land, from a fresh read of the keys it named: every
 * refusal comes back as the same `invalidState`, so the page explains it.
 */
export async function explain(state, act, balance) {
  for (const { key, oldValue } of act.actions) {
    const now = await state.get(key);
    if (now === oldValue) continue;
    if (key.startsWith("lot/")) {
      const was = oldValue && parseLot(oldValue), is = now && parseLot(now);
      if (!oldValue) return "Someone else claimed this lot first.";
      if (was && is && was.owner !== is.owner) return "Someone else bought it first.";
      if (was && is && was.price !== is.price) return `The price changed to ${is.price} before your write landed.`;
    }
    if (key.startsWith("bld/")) return "The building changed before your write landed.";
    return "Something changed before your write landed. Try again.";
  }
  const owed = act.payments.reduce((s, p) => s + p.amount, 0n);
  if (balance !== undefined && balance < owed + 1n) return `Not enough coin: this needs ${owed + 1n}, you have ${balance}.`;
  return "The chain refused the write.";
}
