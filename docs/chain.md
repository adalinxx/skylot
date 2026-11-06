# Skylot on Lattice

Skylot's city is one Lattice child chain. The chain is the database, a WASM
validity policy is the rules, and the page is the app. Walkers, traffic,
weather and sky ads stay simulated in the browser; land, buildings and brands
live on the chain.

- **Trial path:** `Nexus/testnet/skylot-<6 hex>`, hosted by the testnet apps
  host and merge-mined by the testnet fleet.
- **Rules file:** `chain/rules.json` holds every number the policy checks
  (lot prices, floor costs, caps, the burn address). The policy embeds the same
  values; a test fails if the two disagree.

## Records

Values are short text, not JSON, except a brand, so the policy can check them
without a JSON parser.

| Key | Value | Who may write |
|---|---|---|
| `lot/<x>,<y>` | `<owner>@<price>` | Claim: anyone, burning the lot's price. Owner: change the price or give it away. Anyone else: take it at the listed price, paying the owner in the same transaction. Never deleted. |
| `bld/<x>,<y>` | `<floors> <style> <at>` | Only the lot's owner (shown by naming `lot/<x>,<y>` in the same transaction). Each new floor burns its cost. |
| `user/<a>/brand` | JSON `{name, art, image?, link?}` | `<a>` |
| `user/<a>/<anything>` | anything up to 4 KB | `<a>` |

- `<x>,<y>` are decimal integers with no leading zeros. A lot is a grid tile
  inside the 17 × 17 city that is not a street: neither coordinate is a
  multiple of 4. That's 144 lots.
- `<price>` is a positive decimal integer of coin with no leading zeros. Every
  lot is always for sale: the value must carry a price. A very high price keeps
  a lot, at no cost.
- `<style>` is `glass`, `brick` or `stone`.
- `<at>` is the block time in ms when the building last reached its height.
  The skyline board breaks ties by the earlier `at`.

## Rules the policy enforces

**Burning.** Coin is burned by paying the burn address,
`bafyreidpifgzf5xtcgjeeruxls2cjah74as3q72wni7yyigzjjc5272d54`. It is the
dag-cbor CIDv1 of `sha256("skylot:burn")`: an address whose digest is a plain
hash rather than a key's, so nobody can sign for it and its coin never moves.
(Paying more than you credit doesn't burn on Lattice: the difference is the
fee, and the miner gets it.) A transaction must credit the burn address at
least the sum of every burn it owes.

**Claiming a lot** (`lot/<x>,<y>` with no old value):
- the key names a lot (not a street, inside the grid);
- the new value is `<holder>@<price>`;
- it owes the lot's price from `rules.json` `lotPrices` (20 to 84 coin, by
  distance from the centre, ×1.5 facing a main street);
- the same transaction creates `bld/<x>,<y>` at 1 floor.

**Changing a lot** (old value present):
- the new value is `<holder>@<price>`; deleting is refused;
- if the old holder signs: anything (reprice, give away);
- otherwise: the old value must carry a price, and the transaction must credit
  the old holder at least the sum of the prices of every lot it takes from
  them (`check_payments` from `lattice-policy-rules`). Because the buyer names
  the value it read, a price change in the meantime makes the purchase fail
  rather than overcharge.

**Building** (`bld/<x>,<y>`):
- the same transaction has an action on `lot/<x>,<y>` whose new value's holder
  signs (claiming it, buying it, or naming it unchanged to prove ownership);
- the value is `<floors> <style> <at>` with 1 ≤ floors ≤ 30;
- created: floors is 1, and `lot/<x>,<y>` is created in the same transaction;
- floors + 1: owes `14 × 2^(floors − 1)` (the 2nd floor burns 14, the 3rd 28,
  the 12th 14,336); `at` changes;
- same floors: a restyle, at no cost; `at` must not change;
- fewer floors, or deleting: refused;
- a changed `at` is within 10 minutes of the block's timestamp.

**Brands** (`user/<a>/brand`): `<a>` signs; the value is at most 32,768 bytes
and never contains `image/svg`. The page treats every brand as untrusted: it
draws only a `data:image/png|jpeg|webp` image, decodes it into a bitmap first,
and opens a `link` only if it's `https:`, after showing its domain.

**Everything else:** `user/<a>/…` (owner signs, ≤ 4 KB). Any other key is
refused. Coin payments pass untouched.

A bought building keeps its floors and `at`, so its skyline rank counts fully
for the new owner. Rules say nothing about bots: an account is an account.

## Coin

- The spec premines a faucet account at genesis. On testnet, its key is kept by
  the operator, outside the repo; `client/faucet.mjs` sends players coin.
- Block rewards go to whoever mines the chain.
- Writes cost the chain's `minRelayFee` (the trial host's setting).
- Later: in-browser grinding through the fee sponsor (`/sponsor/work`), which
  is the brief's "grind for a sponsor" loop.

## Not on chain yet

- Sign rentals, banner planes, the blimp, taxi-top ads, the plaza billboard and
  fireworks. In chain mode the page hides them; offline mode keeps them.
- Neighbour floors in the lot price: the policy can't cheaply prove a
  neighbouring lot is empty, so on-chain prices depend on location only.
