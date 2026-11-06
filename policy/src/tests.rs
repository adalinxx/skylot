//! Native tests of `validate` on hand-built contexts: every accept case,
//! every reject case and malformed input. The JS suite (`test/`) runs the
//! built module on SDK-encoded bodies, and `host-check` replays those through
//! Lattice's own evaluator.
use super::*;

// ---------------------------------------------------------------------------
// Fixtures: a minimal DAG-CBOR encoder, the context envelope, and accounts.

fn head(out: &mut Vec<u8>, major: u8, argument: u64) {
    let major = major << 5;
    match argument {
        0..=23 => out.push(major | argument as u8),
        24..=0xff => out.extend([major | 24, argument as u8]),
        0x100..=0xffff => {
            out.push(major | 25);
            out.extend((argument as u16).to_be_bytes());
        }
        0x1_0000..=0xffff_ffff => {
            out.push(major | 26);
            out.extend((argument as u32).to_be_bytes());
        }
        _ => {
            out.push(major | 27);
            out.extend(argument.to_be_bytes());
        }
    }
}

fn text(out: &mut Vec<u8>, value: &str) {
    head(out, 3, value.len() as u64);
    out.extend(value.as_bytes());
}

fn int(out: &mut Vec<u8>, value: i64) {
    if value >= 0 {
        head(out, 0, value as u64);
    } else {
        head(out, 1, (-1 - value) as u64);
    }
}

/// How an action spells an absent value.
#[derive(Clone, Copy)]
enum Absent {
    Omitted,
    Null,
}

#[derive(Clone)]
struct Write {
    key: String,
    old: Option<String>,
    new: Option<String>,
}

fn put(key: &str, old: Option<&str>, new: Option<&str>) -> Write {
    Write { key: key.into(), old: old.map(Into::into), new: new.map(Into::into) }
}

#[derive(Clone, Default)]
struct Tx {
    writes: Vec<Write>,
    signers: Vec<String>,
    credits: Vec<(String, i64)>,
}

impl Tx {
    fn by(signers: &[&str]) -> Self {
        Tx { signers: signers.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }
    fn write(mut self, key: &str, old: Option<&str>, new: Option<&str>) -> Self {
        self.writes.push(put(key, old, new));
        self
    }
    fn pay(mut self, owner: &str, delta: i64) -> Self {
        self.credits.push((owner.into(), delta));
        self
    }
    fn burn(self, amount: i64) -> Self {
        self.pay(BURN_ADDRESS, amount)
    }

    fn body(&self, absent: Absent) -> Vec<u8> {
        let mut out = Vec::new();
        head(&mut out, 5, 8);
        text(&mut out, "nonce");
        int(&mut out, 7);
        text(&mut out, "actions");
        head(&mut out, 4, self.writes.len() as u64);
        for write in &self.writes {
            let fields = 1
                + match absent {
                    Absent::Null => 2,
                    Absent::Omitted => write.old.is_some() as u64 + write.new.is_some() as u64,
                };
            head(&mut out, 5, fields);
            text(&mut out, "key");
            text(&mut out, &write.key);
            for (name, value) in [("newValue", &write.new), ("oldValue", &write.old)] {
                match (value, absent) {
                    (Some(value), _) => {
                        text(&mut out, name);
                        text(&mut out, value);
                    }
                    (None, Absent::Null) => {
                        text(&mut out, name);
                        out.push(0xf6);
                    }
                    (None, Absent::Omitted) => {}
                }
            }
        }
        text(&mut out, "signers");
        head(&mut out, 4, self.signers.len() as u64);
        for signer in &self.signers {
            text(&mut out, signer);
        }
        text(&mut out, "chainPath");
        head(&mut out, 4, 2);
        text(&mut out, "Nexus");
        text(&mut out, "skylot");
        text(&mut out, "depositActions");
        head(&mut out, 4, 0);
        text(&mut out, "receiptActions");
        head(&mut out, 4, 0);
        text(&mut out, "accountActions");
        head(&mut out, 4, self.credits.len() as u64);
        for (owner, delta) in &self.credits {
            head(&mut out, 5, 2);
            text(&mut out, "delta");
            int(&mut out, *delta);
            text(&mut out, "owner");
            text(&mut out, owner);
        }
        text(&mut out, "withdrawalActions");
        head(&mut out, 4, 0);
        out
    }

    fn at(&self, now: i64) -> bool {
        validate(&context(Some(&self.body(Absent::Omitted)), now, 2))
    }
    /// The verdict at `NOW`, which must not depend on how absent values are
    /// spelled.
    fn ok(&self) -> bool {
        let omitted = validate(&context(Some(&self.body(Absent::Omitted)), NOW, 2));
        let null = validate(&context(Some(&self.body(Absent::Null)), NOW, 2));
        assert_eq!(omitted, null, "null and omitted values disagree");
        omitted
    }
}

fn context(body: Option<&[u8]>, timestamp: i64, version: u16) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend(b"LWPCTX");
    out.extend(version.to_be_bytes());
    out.extend(1u16.to_be_bytes()); // ABI version
    out.push(0); // transaction scope
    out.extend(100u64.to_be_bytes());
    out.extend(timestamp.to_be_bytes());
    out.extend(3u32.to_be_bytes());
    out.extend([0xa0, 0xa0, 0xa0]); // stand-in spec; the policy skips it
    out.extend(2u32.to_be_bytes());
    for segment in ["Nexus", "skylot"] {
        out.extend((segment.len() as u32).to_be_bytes());
        out.extend(segment.as_bytes());
    }
    match body {
        Some(body) => {
            out.push(1);
            out.extend((body.len() as u32).to_be_bytes());
            out.extend(body);
        }
        None => out.push(0),
    }
    out.extend([0, 0]); // no action, no action index
    out
}

const NOW: i64 = 1_800_000_000_000;
const BURN_ADDRESS: &str = "bafyreidpifgzf5xtcgjeeruxls2cjah74as3q72wni7yyigzjjc5272d54";

/// A canonical address: `bafyrei`, then a first character worth less than 8
/// and 51 `a`s (the last worth 0).
fn address(first: char) -> &'static str {
    Box::leak(format!("bafyrei{first}{}", "a".repeat(51)).into_boxed_str())
}

fn alice() -> &'static str {
    address('b')
}
fn bob() -> &'static str {
    address('c')
}
fn carol() -> &'static str {
    address('d')
}

fn lot(holder: &str, price: u64) -> String {
    format!("{holder}@{price}")
}
fn bld(floors: u64, style: &str, at: i64) -> String {
    format!("{floors} {style} {at}")
}

/// A claim of `x,y` by `who`, burning `burn`.
fn claim(who: &str, x: u32, y: u32, burn: i64) -> Tx {
    Tx::by(&[who])
        .write(&format!("lot/{x},{y}"), None, Some(&lot(who, 500)))
        .write(&format!("bld/{x},{y}"), None, Some(&bld(1, "glass", NOW)))
        .burn(burn)
}

// ---------------------------------------------------------------------------
// The rules file.

#[test]
fn embedded_rules_match_rules_json() {
    let rules: serde_json::Value =
        serde_json::from_str(include_str!("../../chain/rules.json")).expect("rules.json parses");
    let number = |name: &str| rules[name].as_u64().unwrap_or_else(|| panic!("{name}"));
    assert_eq!(number("grid"), GRID as u64);
    assert_eq!(number("streetEvery"), STREET_EVERY);
    assert_eq!(number("floorBase"), FLOOR_BASE);
    assert_eq!(number("floorGrowth"), FLOOR_GROWTH);
    assert_eq!(number("maxFloors"), MAX_FLOORS);
    assert_eq!(number("timeWindowMs"), TIME_WINDOW_MS);
    assert_eq!(number("brandMaxBytes"), BRAND_MAX_BYTES as u64);
    assert_eq!(number("userMaxBytes"), USER_MAX_BYTES as u64);
    assert_eq!(rules["burn"].as_str().unwrap().as_bytes(), BURN);
    assert_eq!(BURN, BURN_ADDRESS.as_bytes());
    assert!(is_address(BURN));

    let prices = rules["lotPrices"].as_object().unwrap();
    let mut embedded = 0;
    for y in 0..GRID {
        for x in 0..GRID {
            let listed = prices.get(&format!("{x},{y}")).map(|price| price.as_u64().unwrap());
            let price = LOT_PRICES[y][x];
            assert_eq!(listed.unwrap_or(0), price, "lot {x},{y}");
            embedded += (price > 0) as usize;
        }
    }
    assert_eq!(embedded, prices.len(), "rules.json lists a lot outside the grid");
}

#[test]
fn lots_are_the_144_tiles_off_the_streets() {
    let mut lots = 0;
    for y in 0..GRID {
        for x in 0..GRID {
            let street = x as u64 % STREET_EVERY == 0 || y as u64 % STREET_EVERY == 0;
            assert_eq!(LOT_PRICES[y][x] == 0, street, "{x},{y}");
            lots += !street as usize;
        }
    }
    assert_eq!(lots, 144);
    let all = LOT_PRICES.iter().flatten().filter(|&&price| price > 0);
    assert!(all.clone().all(|&price| (20..=84).contains(&price)));
}

#[test]
fn floor_costs_double_from_14() {
    assert_eq!(floor_cost(1), Some(14)); // the 2nd floor
    assert_eq!(floor_cost(2), Some(28)); // the 3rd
    assert_eq!(floor_cost(11), Some(14_336)); // the 12th
    assert_eq!(floor_cost(29), Some(14 << 28)); // the 30th
    assert_eq!(floor_cost(0), None);
    for floors in 1..MAX_FLOORS {
        assert_eq!(floor_cost(floors), Some((FLOOR_BASE as u128) << (floors - 1)));
    }
    assert_eq!(floor_cost(u64::MAX), None);
}

#[test]
fn the_timestamp_is_read_at_offset_19() {
    let bytes = context(Some(&Tx::default().body(Absent::Omitted)), NOW, 2);
    assert_eq!(block_timestamp(&bytes), Some(NOW));
    assert_eq!(&bytes[19..27], &NOW.to_be_bytes());
    assert_eq!(block_timestamp(&bytes[..26]), None);
}

// ---------------------------------------------------------------------------
// Claiming.

#[test]
fn a_claim_burns_the_lot_price_and_builds_one_floor() {
    assert!(claim(alice(), 1, 1, 20).ok());
    assert!(claim(alice(), 7, 7, 84).ok());
    // Burning more is allowed; the split across credits is summed.
    assert!(claim(alice(), 1, 1, 25).ok());
    assert!(claim(alice(), 1, 1, 12).burn(8).ok());
    // Too little, nothing, or a debit of the burn address.
    assert!(!claim(alice(), 1, 1, 19).ok());
    assert!(!claim(alice(), 7, 7, 83).ok());
    assert!(!claim(alice(), 1, 1, 12).burn(-1).burn(7).ok());
    let unpaid = Tx { credits: vec![], ..claim(alice(), 1, 1, 0) };
    assert!(!unpaid.ok());
    // Paying someone else is not a burn.
    let elsewhere = Tx { credits: vec![(bob().into(), 20)], ..claim(alice(), 1, 1, 0) };
    assert!(!elsewhere.ok());
}

#[test]
fn every_lot_costs_its_listed_price() {
    for y in 0..GRID as u32 {
        for x in 0..GRID as u32 {
            let price = LOT_PRICES[y as usize][x as usize] as i64;
            if price == 0 {
                assert!(!claim(alice(), x, y, 1000).ok(), "street {x},{y}");
            } else {
                assert!(claim(alice(), x, y, price).ok(), "{x},{y}");
                assert!(!claim(alice(), x, y, price - 1).ok(), "{x},{y}");
            }
        }
    }
}

#[test]
fn several_claims_burn_the_sum() {
    let two = |burn| {
        Tx::by(&[alice()])
            .write("lot/1,1", None, Some(&lot(alice(), 9)))
            .write("bld/1,1", None, Some(&bld(1, "glass", NOW)))
            .write("lot/2,1", None, Some(&lot(alice(), 9)))
            .write("bld/2,1", None, Some(&bld(1, "brick", NOW)))
            .burn(burn)
    };
    assert!(two(42).ok());
    assert!(!two(41).ok());
}

#[test]
fn a_claim_needs_its_building_at_one_floor() {
    let lot_only = Tx::by(&[alice()]).write("lot/1,1", None, Some(&lot(alice(), 9))).burn(20);
    assert!(!lot_only.ok());
    // Building elsewhere does not count.
    assert!(!lot_only.clone().write("bld/2,1", None, Some(&bld(1, "glass", NOW))).ok());
    assert!(!Tx::by(&[alice()])
        .write("lot/1,1", None, Some(&lot(alice(), 9)))
        .write("bld/1,1", None, Some(&bld(2, "glass", NOW)))
        .burn(20 + 14)
        .ok());
    // A building that already exists is not created by the claim.
    assert!(!Tx::by(&[alice()])
        .write("lot/1,1", None, Some(&lot(alice(), 9)))
        .write("bld/1,1", Some(&bld(1, "glass", NOW)), Some(&bld(1, "glass", NOW)))
        .burn(20)
        .ok());
}

#[test]
fn a_claim_needs_the_new_holder_to_sign() {
    // Bob claims in Alice's name: the building needs Alice's signature.
    assert!(!Tx::by(&[bob()])
        .write("lot/1,1", None, Some(&lot(alice(), 9)))
        .write("bld/1,1", None, Some(&bld(1, "glass", NOW)))
        .burn(20)
        .ok());
    assert!(Tx::by(&[bob(), alice()])
        .write("lot/1,1", None, Some(&lot(alice(), 9)))
        .write("bld/1,1", None, Some(&bld(1, "glass", NOW)))
        .burn(20)
        .ok());
}

#[test]
fn lot_keys_name_a_lot_in_one_spelling() {
    for key in [
        "4,1", "1,4", "0,0", "16,16", "8,8", "17,1", "1,17", "99,1", "01,1", "1,01", "00,1", "1", "1,",
        ",1", "", "1,1,1", " 1,1", "1,1 ", "-1,1", "+1,1", "1;1", "a,1", "18446744073709551617,1",
    ] {
        let tx = Tx::by(&[alice()])
            .write(&format!("lot/{key}"), None, Some(&lot(alice(), 9)))
            .write(&format!("bld/{key}"), None, Some(&bld(1, "glass", NOW)))
            .burn(1000);
        assert!(!tx.ok(), "lot/{key}");
    }
}

#[test]
fn a_lot_value_is_an_address_at_a_positive_price() {
    let a = alice();
    for value in [
        a.to_string(),
        format!("{a}@0"),
        format!("{a}@01"),
        format!("{a}@"),
        format!("{a}@-5"),
        format!("{a}@5@6"),
        format!("{a}@ 5"),
        format!("{a}@5 "),
        format!("{a}@18446744073709551616"),
        "@5".into(),
        "alice@5".into(),
        format!("{}@5", a.to_uppercase()),
        format!("{}b@5", &a[..58]), // last character's spare bits set
        format!("{a}a@5"),
        String::new(),
    ] {
        let tx = Tx::by(&[a])
            .write("lot/1,1", None, Some(&value))
            .write("bld/1,1", None, Some(&bld(1, "glass", NOW)))
            .burn(20);
        assert!(!tx.ok(), "{value:?}");
    }
    let max = Tx::by(&[a])
        .write("lot/1,1", None, Some(&lot(a, u64::MAX)))
        .write("bld/1,1", None, Some(&bld(1, "glass", NOW)))
        .burn(20);
    assert!(max.ok());
    assert!(claim(a, 1, 1, 20).write("lot/2,1", Some(&lot(a, 5)), Some(&lot(a, 1))).ok());
}

// ---------------------------------------------------------------------------
// Changing and buying lots.

#[test]
fn the_holder_reprices_or_gives_away_but_never_deletes() {
    let held = lot(alice(), 20);
    let by_alice = |new: Option<&str>| Tx::by(&[alice()]).write("lot/1,1", Some(&held), new);
    assert!(by_alice(Some(&lot(alice(), 1000))).ok());
    assert!(by_alice(Some(&lot(alice(), 20))).ok()); // naming it unchanged
    assert!(by_alice(Some(&lot(bob(), 1))).ok()); // a gift
    assert!(!by_alice(None).ok());
    assert!(!by_alice(Some(alice())).ok());
    assert!(!by_alice(Some(&format!("{}@0", alice()))).ok());
}

#[test]
fn anyone_else_takes_a_lot_by_paying_its_price() {
    let held = lot(alice(), 50);
    let buy = |paid: i64| {
        Tx::by(&[bob()])
            .write("lot/1,1", Some(&held), Some(&lot(bob(), 9000)))
            .pay(bob(), -paid)
            .pay(alice(), paid)
    };
    assert!(buy(50).ok());
    assert!(buy(51).ok());
    assert!(!buy(49).ok());
    assert!(!Tx::by(&[bob()]).write("lot/1,1", Some(&held), Some(&lot(bob(), 1))).ok());
    // Buying also may not delete or leave a bad value.
    assert!(!Tx::by(&[bob()]).write("lot/1,1", Some(&held), None).pay(alice(), 50).ok());
    assert!(!Tx::by(&[bob()]).write("lot/1,1", Some(&held), Some(bob())).pay(alice(), 50).ok());
    // Paying the burn address is not paying Alice.
    assert!(!Tx::by(&[bob()]).write("lot/1,1", Some(&held), Some(&lot(bob(), 1))).burn(50).ok());
}

#[test]
fn several_lots_from_one_holder_are_paid_for_together() {
    let buy = |paid: i64| {
        Tx::by(&[bob()])
            .write("lot/1,1", Some(&lot(alice(), 50)), Some(&lot(bob(), 9)))
            .write("lot/2,1", Some(&lot(alice(), 30)), Some(&lot(bob(), 9)))
            .write("lot/3,1", Some(&lot(carol(), 7)), Some(&lot(bob(), 9)))
            .pay(alice(), paid)
            .pay(carol(), 7)
    };
    assert!(buy(80).ok());
    assert!(!buy(79).ok());
    assert!(!buy(50).ok());
}

#[test]
fn a_buyer_builds_on_the_lot_in_the_same_transaction() {
    let tx = |burn: i64| {
        Tx::by(&[bob()])
            .write("lot/1,1", Some(&lot(alice(), 50)), Some(&lot(bob(), 9)))
            .write("bld/1,1", Some(&bld(3, "glass", 5)), Some(&bld(4, "stone", NOW)))
            .pay(alice(), 50)
            .burn(burn)
    };
    assert!(tx(56).ok());
    assert!(!tx(55).ok());
    // The seller can't build on a lot they are handing over.
    assert!(!Tx::by(&[alice()])
        .write("lot/1,1", Some(&lot(alice(), 50)), Some(&lot(bob(), 9)))
        .write("bld/1,1", Some(&bld(3, "glass", 5)), Some(&bld(4, "glass", NOW)))
        .burn(56)
        .ok());
}

#[test]
fn a_lot_held_by_the_burn_address_is_bought_on_top_of_every_burn() {
    // Some lot was given to the burn address at 30. Buying it pays the burn
    // address, and that payment can't also pay for a claim.
    let tx = |burned: i64| {
        Tx::by(&[bob()])
            .write("lot/1,1", Some(&lot(BURN_ADDRESS, 30)), Some(&lot(bob(), 9)))
            .write("lot/2,1", None, Some(&lot(bob(), 9)))
            .write("bld/2,1", None, Some(&bld(1, "glass", NOW)))
            .burn(burned)
    };
    assert!(tx(30 + 22).ok());
    assert!(!tx(30).ok());
    assert!(!tx(51).ok());
    // Alone, the purchase pays the price.
    let alone = |burned| {
        Tx::by(&[bob()]).write("lot/1,1", Some(&lot(BURN_ADDRESS, 30)), Some(&lot(bob(), 9))).burn(burned)
    };
    assert!(alone(30).ok());
    assert!(!alone(29).ok());
}

#[test]
fn a_malformed_old_lot_value_is_refused() {
    // Consensus would not have stored one, but the policy does not assume so.
    for old in [alice().to_string(), format!("{}@0", alice()), "junk".into()] {
        assert!(!Tx::by(&[alice()]).write("lot/1,1", Some(&old), Some(&lot(alice(), 5))).ok(), "{old}");
    }
}

// ---------------------------------------------------------------------------
// Building.

fn raise(old: &str, new: &str, burn: i64) -> Tx {
    Tx::by(&[alice()])
        .write("lot/1,1", Some(&lot(alice(), 20)), Some(&lot(alice(), 20)))
        .write("bld/1,1", Some(old), Some(new))
        .burn(burn)
}

#[test]
fn each_new_floor_burns_its_cost() {
    assert!(raise(&bld(1, "glass", 5), &bld(2, "glass", NOW), 14).ok());
    assert!(!raise(&bld(1, "glass", 5), &bld(2, "glass", NOW), 13).ok());
    assert!(raise(&bld(2, "glass", 5), &bld(3, "brick", NOW), 28).ok());
    assert!(raise(&bld(11, "stone", 5), &bld(12, "stone", NOW), 14_336).ok());
    assert!(!raise(&bld(11, "stone", 5), &bld(12, "stone", NOW), 14_335).ok());
    assert!(raise(&bld(29, "glass", 5), &bld(30, "glass", NOW), 14 << 28).ok());
    assert!(!raise(&bld(29, "glass", 5), &bld(30, "glass", NOW), (14 << 28) - 1).ok());
    // Thirty floors is the top.
    assert!(!raise(&bld(30, "glass", 5), &bld(31, "glass", NOW), i64::MAX).ok());
}

#[test]
fn floors_rise_one_at_a_time_and_never_fall() {
    assert!(!raise(&bld(1, "glass", 5), &bld(3, "glass", NOW), 1_000_000).ok());
    assert!(!raise(&bld(3, "glass", 5), &bld(2, "glass", NOW), 1_000_000).ok());
    assert!(!raise(&bld(3, "glass", 5), &bld(1, "glass", NOW), 1_000_000).ok());
    let delete = Tx::by(&[alice()])
        .write("lot/1,1", Some(&lot(alice(), 20)), Some(&lot(alice(), 20)))
        .write("bld/1,1", Some(&bld(3, "glass", 5)), None);
    assert!(!delete.ok());
}

#[test]
fn a_restyle_is_free_and_keeps_its_time() {
    assert!(raise(&bld(5, "glass", 5), &bld(5, "brick", 5), 0).ok());
    assert!(raise(&bld(5, "glass", 5), &bld(5, "glass", 5), 0).ok());
    // A restyle can't move its time, even to now.
    assert!(!raise(&bld(5, "glass", 5), &bld(5, "brick", NOW), 0).ok());
    // A new floor must move it.
    let same = bld(5, "glass", NOW);
    assert!(!raise(&same, &bld(6, "glass", NOW), 1_000_000).ok());
}

#[test]
fn a_changed_time_is_within_ten_minutes_of_the_block() {
    let window = TIME_WINDOW_MS as i64;
    let at = |at: i64| raise(&bld(1, "glass", 5), &bld(2, "glass", at), 14);
    assert!(at(NOW).ok());
    assert!(at(NOW - window).ok());
    assert!(at(NOW + window).ok());
    assert!(!at(NOW - window - 1).ok());
    assert!(!at(NOW + window + 1).ok());
    assert!(!at(0).ok());
    // The same write judged at another block time.
    let tx = at(NOW);
    assert!(tx.at(NOW + window));
    assert!(!tx.at(NOW + window + 1));
    assert!(!tx.at(0));
    assert!(!tx.at(-1));
    // A building created with its lot is timed too.
    let created = |at: i64| {
        Tx::by(&[alice()])
            .write("lot/1,1", None, Some(&lot(alice(), 9)))
            .write("bld/1,1", None, Some(&bld(1, "glass", at)))
            .burn(20)
    };
    assert!(created(NOW - window).ok());
    assert!(!created(NOW - window - 1).ok());
    assert!(!created(NOW + window + 1).ok());
}

#[test]
fn only_the_lots_signing_holder_builds() {
    let bump = (bld(1, "glass", 5), bld(2, "glass", NOW));
    // No action on the lot.
    assert!(!Tx::by(&[alice()]).write("bld/1,1", Some(&bump.0), Some(&bump.1)).burn(14).ok());
    // An action on another lot.
    assert!(!Tx::by(&[alice()])
        .write("lot/2,1", Some(&lot(alice(), 20)), Some(&lot(alice(), 20)))
        .write("bld/1,1", Some(&bump.0), Some(&bump.1))
        .burn(14)
        .ok());
    // Bob names Alice's lot unchanged, paying her: he still isn't its holder.
    assert!(!Tx::by(&[bob()])
        .write("lot/1,1", Some(&lot(alice(), 20)), Some(&lot(alice(), 20)))
        .write("bld/1,1", Some(&bump.0), Some(&bump.1))
        .pay(alice(), 20)
        .burn(14)
        .ok());
    // Alice gives the lot away and builds: the new holder hasn't signed.
    assert!(!Tx::by(&[alice()])
        .write("lot/1,1", Some(&lot(alice(), 20)), Some(&lot(bob(), 20)))
        .write("bld/1,1", Some(&bump.0), Some(&bump.1))
        .burn(14)
        .ok());
    // With Bob's signature, it is his to build.
    assert!(Tx::by(&[alice(), bob()])
        .write("lot/1,1", Some(&lot(alice(), 20)), Some(&lot(bob(), 20)))
        .write("bld/1,1", Some(&bump.0), Some(&bump.1))
        .burn(14)
        .ok());
}

#[test]
fn a_building_is_created_only_with_its_lot() {
    assert!(!Tx::by(&[alice()])
        .write("lot/1,1", Some(&lot(alice(), 20)), Some(&lot(alice(), 20)))
        .write("bld/1,1", None, Some(&bld(1, "glass", NOW)))
        .ok());
}

#[test]
fn a_building_value_has_one_spelling() {
    for value in [
        "2 glass", "2", "", "2  glass 5", " 2 glass 5", "2 glass 5 ", "2 glass 5 x", "02 glass 5", "0 glass 5",
        "31 glass 5", "2 wood 5", "2 Glass 5", "2 glass 05", "2 glass -5", "2 glass ", "2\tglass\t5",
        "2 glass 18446744073709551616",
    ] {
        let value = value.replace('5', &NOW.to_string());
        assert!(!raise(&bld(1, "glass", 5), &value, 1_000_000).ok(), "{value:?}");
    }
    // A malformed old value is refused too.
    assert!(!raise("1 wood 5", &bld(2, "glass", NOW), 14).ok());
}

#[test]
fn building_keys_name_a_lot() {
    let restyle = |key: &str| {
        Tx::by(&[alice()])
            .write(&format!("lot/{key}"), Some(&lot(alice(), 20)), Some(&lot(alice(), 20)))
            .write(&format!("bld/{key}"), Some(&bld(1, "glass", 5)), Some(&bld(1, "brick", 5)))
    };
    assert!(restyle("15,15").ok());
    for key in ["4,1", "0,0", "17,1", "01,1", "1", ""] {
        assert!(!restyle(key).ok(), "{key}");
    }
}

#[test]
fn a_whole_city_block_in_one_transaction() {
    // Claim a lot, raise another, restyle a third and buy a fourth.
    let tx = Tx::by(&[alice()])
        .write("lot/1,1", None, Some(&lot(alice(), 100)))
        .write("bld/1,1", None, Some(&bld(1, "glass", NOW)))
        .write("lot/2,1", Some(&lot(alice(), 5)), Some(&lot(alice(), 5)))
        .write("bld/2,1", Some(&bld(2, "glass", 1)), Some(&bld(3, "glass", NOW)))
        .write("lot/3,1", Some(&lot(alice(), 5)), Some(&lot(alice(), 5)))
        .write("bld/3,1", Some(&bld(4, "glass", 1)), Some(&bld(4, "stone", 1)))
        .write("lot/5,1", Some(&lot(bob(), 70)), Some(&lot(alice(), 70)))
        .write(&format!("user/{}/note", alice()), None, Some("hi"))
        .pay(alice(), -1000)
        .pay(bob(), 70);
    assert!(tx.clone().burn(20 + 28).ok());
    assert!(!tx.burn(20 + 27).ok());
}

// ---------------------------------------------------------------------------
// User records and brands.

#[test]
fn users_write_their_own_records_up_to_4_kb() {
    let mine = |rest: &str, new: Option<&str>| Tx::by(&[alice()]).write(&format!("user/{}/{rest}", alice()), None, new);
    assert!(mine("note", Some("hello")).ok());
    assert!(mine("note", Some("")).ok());
    assert!(mine("a/b/c", Some("x")).ok());
    assert!(mine("note", Some(&"x".repeat(4096))).ok());
    assert!(!mine("note", Some(&"x".repeat(4097))).ok());
    // An SVG is not a brand concern outside `brand`.
    assert!(mine("note", Some("image/svg+xml")).ok());
    // Deleting.
    assert!(Tx::by(&[alice()]).write(&format!("user/{}/note", alice()), Some("hello"), None).ok());
    // A deeper `brand` is an ordinary record.
    assert!(!mine("brand/x", Some(&"x".repeat(4097))).ok());
}

#[test]
fn nobody_writes_another_users_records() {
    let a = alice();
    for key in [format!("user/{}/note", bob()), format!("user/{}/brand", bob()), format!("user/{}/{a}", bob())] {
        assert!(!Tx::by(&[a]).write(&key, None, Some("x")).ok(), "{key}");
        assert!(!Tx::by(&[a]).write(&key, Some("x"), None).ok(), "{key}");
    }
    // One bad action rejects the whole transaction.
    assert!(!Tx::by(&[a])
        .write(&format!("user/{a}/note"), None, Some("mine"))
        .write(&format!("user/{}/note", bob()), None, Some("not mine"))
        .ok());
    assert!(Tx::by(&[a, bob()]).write(&format!("user/{}/note", bob()), None, Some("x")).ok());
}

#[test]
fn a_brand_is_up_to_32_kb_and_never_an_svg() {
    let brand = |value: &str| Tx::by(&[alice()]).write(&format!("user/{}/brand", alice()), None, Some(value));
    assert!(brand(r#"{"name":"Acme","art":"rocket"}"#).ok());
    assert!(brand(r#"{"name":"A","art":"x","image":"data:image/png;base64,AAAA"}"#).ok());
    assert!(brand(&"x".repeat(32768)).ok());
    assert!(!brand(&"x".repeat(32769)).ok());
    for svg in [
        r#"{"image":"data:image/svg+xml;base64,AAAA"}"#,
        "image/svg",
        "xxIMAGE/SVGxx",
        "Image/Svg",
        r#"{"image":"data:image\/svg+xml,<svg/>"}"#,
    ] {
        assert!(!brand(svg).ok(), "{svg}");
    }
    assert!(brand("image/sv").ok());
    assert!(Tx::by(&[alice()]).write(&format!("user/{}/brand", alice()), Some("{}"), None).ok());
}

#[test]
fn keys_outside_the_four_shapes_are_refused() {
    let a = alice();
    for key in [
        a.to_string(),
        "lot".into(),
        "lot/".into(),
        "lots/1,1".into(),
        "LOT/1,1".into(),
        "bld".into(),
        "/lot/1,1".into(),
        "user".into(),
        "user/".into(),
        format!("user/{a}"),
        format!("user/{a}/"),
        "user//note".into(),
        format!("users/{a}/note"),
        format!("own/{a}/x"),
        "x".into(),
    ] {
        assert!(!Tx::by(&[a]).write(&key, None, Some("x")).burn(1000).ok(), "{key}");
    }
}

// ---------------------------------------------------------------------------
// Coin and malformed input.

#[test]
fn coin_actions_pass_untouched() {
    assert!(Tx::by(&[alice()]).ok());
    assert!(Tx::by(&[alice()]).pay(alice(), -1000).pay(bob(), 998).ok());
    assert!(Tx::by(&[alice()]).pay(alice(), -5).burn(5).ok());
}

#[test]
fn a_malformed_or_unknown_context_is_refused() {
    let good = claim(alice(), 1, 1, 20).body(Absent::Omitted);
    assert!(validate(&context(Some(&good), NOW, 2)));
    assert!(!validate(&context(Some(&good), NOW, 1)));
    assert!(!validate(&context(Some(&good), NOW, 3)));
    assert!(!validate(&context(None, NOW, 2)));
    assert!(!validate(&context(Some(&good[..good.len() - 3]), NOW, 2)));
    let mut trailing = good.clone();
    trailing.push(0);
    assert!(!validate(&context(Some(&trailing), NOW, 2)));
    assert!(!validate(&context(Some(&[0xa0]), NOW, 2)));
    assert!(!validate(&context(Some(&[]), NOW, 2)));
    let whole = context(Some(&good), NOW, 2);
    for cut in [0, 6, 18, 26, 27, 40, whole.len() - 3] {
        assert!(!validate(&whole[..cut]), "cut at {cut}");
    }
    let mut magic = whole.clone();
    magic[0] = b'X';
    assert!(!validate(&magic));
    assert!(!validate(&[]));
    // Every single-byte truncation or corruption of the body is either
    // refused or still parses; it never panics.
    for index in 0..good.len() {
        let mut bent = good.clone();
        bent[index] ^= 0xff;
        let _ = validate(&context(Some(&bent), NOW, 2));
        let _ = validate(&context(Some(&good[..index]), NOW, 2));
    }
}

#[test]
fn without_signers_nothing_is_built() {
    let mut tx = claim(alice(), 1, 1, 20);
    tx.signers.clear();
    assert!(!tx.ok());
}
