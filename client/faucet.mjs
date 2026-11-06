// Testnet faucet: sends Skylot coin from the faucet account (premined at
// genesis) to a player. Run by the operator; the key file never goes in the
// repo.
//
//   node client/faucet.mjs --node https://<host> --chain Nexus/testnet/skylot-xxxxxx \
//        --key ~/.skylot/faucet.json --to <address> [--amount 2000]
import { readFileSync } from "node:fs";
import * as sdk from "../app/vendor/lattice-sdk.js";
import { transaction } from "./skylot.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const node = arg("node"), chain = arg("chain"), to = arg("to"), amount = BigInt(arg("amount", "2000"));
if (!node || !chain || !to || !arg("key")) { console.error("usage: faucet.mjs --node URL --chain PATH --key FILE --to ADDRESS [--amount N]"); process.exit(2); }
if (!/^bafyrei[a-z2-7]{52}$/.test(to)) { console.error(`not an address: ${to}`); process.exit(2); }

const key = JSON.parse(readFileSync(arg("key"), "utf8"));
const me = sdk.accountFromPrivateKey(sdk.hexToBytes(key.privateKey));
const get = async (path) => { const u = new URL(path, node); u.searchParams.set("chainPath", chain); const r = await fetch(u, { cache: "no-store" }); return r.ok ? r.json() : undefined; };
const info = await get("/api/chain/info");
if (!info) { console.error(`${node} doesn't serve ${chain}`); process.exit(1); }
const fee = BigInt(info.minRelayFee ?? 1);
const nonce = BigInt((await get(`/api/state/account/${me.address}`))?.nonce ?? 0);
const body = transaction({ owner: me.address, actions: [], payments: [{ to, amount }], fee, nonce, chainPath: chain.split("/") });
const { publicKey, signature } = sdk.signTransactionBody(body, me.privateKey);
const r = await fetch(new URL("/transactions", node), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sdk.transactionPayload({ [publicKey]: signature }, body)) });
console.log(r.ok ? `sent ${amount} to ${to}` : `refused: ${r.status} ${await r.text()}`);
process.exit(r.ok ? 0 : 1);
