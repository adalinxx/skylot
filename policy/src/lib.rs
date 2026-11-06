//! Transaction-scope validity policy for the Skylot city chain.
//!
//! The contract is `docs/chain.md` ("Records" and "Rules the policy
//! enforces"); every number is from `chain/rules.json`, embedded in
//! `rules.rs`. Four key shapes are allowed, and any other key is refused:
//!
//! - `lot/<x>,<y>`: `<holder>@<price>`. Claimed by burning the lot's price,
//!   with its building created in the same transaction. The holder may change
//!   it in any way but delete it; anyone else may take it by paying the old
//!   holder its listed price in the same transaction.
//! - `bld/<x>,<y>`: `<floors> <style> <at>`, written only alongside an action
//!   on `lot/<x>,<y>` whose new holder signs. Each new floor burns its cost.
//! - `user/<a>/brand`: `<a>` signs; at most 32 KB, never an SVG.
//! - `user/<a>/<anything>`: `<a>` signs; at most 4 KB.
//!
//! A transaction credits the burn address at least the sum of every burn it
//! owes. Coin actions pass untouched. Consensus checks every declared old
//! value against the chain and refuses two actions on one key in a block, so
//! an old value is the key's real value and an absent one means a new key.
#![cfg_attr(not(test), no_std)]

mod rules;

pub use rules::*;

use lattice_policy_rules::{decimal, holding, is_address, transaction_body, Action, Body};

lattice_policy_rules::lattice_policy_abi!(crate::validate);

/// The block timestamp's offset in the context: magic (6), encoding version
/// (2), ABI version (2), scope (1), height (8). An `int64` of milliseconds.
const TIMESTAMP_AT: usize = 6 + 2 + 2 + 1 + 8;

/// The building styles.
const STYLES: [&[u8]; 3] = [b"glass", b"brick", b"stone"];

/// The verdict for one policy context. Anything malformed is a rejection.
pub fn validate(context: &[u8]) -> bool {
    check(context).is_some()
}

fn check(context: &[u8]) -> Option<()> {
    let body = Body::parse(transaction_body(context)?)?;
    let now = block_timestamp(context)?;
    let mut burn: u128 = 0;
    for action in body.actions()? {
        let action = action?;
        let owed = match Key::parse(action.key)? {
            Key::Lot(lot) => check_lot(&body, &action, &lot)?,
            Key::Building(lot) => check_building(&body, &action, &lot, now)?,
            Key::User { owner, brand } => check_user(&body, &action, owner, brand).map(|()| 0)?,
        };
        burn = burn.checked_add(owed)?;
    }
    // Every key reaching here parsed, so `lot/` names a lot.
    body.check_payments(|key| key.starts_with(b"lot/"))?;
    if burn > 0 && body.credited(BURN)? < burn {
        return None;
    }
    Some(())
}

/// The timestamp of the block carrying the transaction, in ms.
pub fn block_timestamp(context: &[u8]) -> Option<i64> {
    let bytes = context.get(TIMESTAMP_AT..TIMESTAMP_AT + 8)?;
    Some(i64::from_be_bytes(bytes.try_into().ok()?))
}

/// A lot: its coordinates as spelled in the key (`<x>,<y>`) and its price.
pub struct Lot<'a> {
    pub coordinates: &'a [u8],
    pub price: u64,
}

impl<'a> Lot<'a> {
    /// The lot `<x>,<y>` names: canonical decimals, inside the grid, and not
    /// a street.
    pub fn parse(coordinates: &'a [u8]) -> Option<Self> {
        let mut parts = coordinates.splitn(2, |&byte| byte == b',');
        let x = usize::try_from(decimal(parts.next()?)?).ok()?;
        let y = usize::try_from(decimal(parts.next()?)?).ok()?;
        let price = *LOT_PRICES.get(y)?.get(x)?;
        (price > 0).then_some(Lot { coordinates, price })
    }
}

enum Key<'a> {
    Lot(Lot<'a>),
    Building(Lot<'a>),
    User { owner: &'a [u8], brand: bool },
}

impl<'a> Key<'a> {
    fn parse(key: &'a [u8]) -> Option<Self> {
        if let Some(coordinates) = key.strip_prefix(b"lot/") {
            return Some(Key::Lot(Lot::parse(coordinates)?));
        }
        if let Some(coordinates) = key.strip_prefix(b"bld/") {
            return Some(Key::Building(Lot::parse(coordinates)?));
        }
        // `user/<a>/<rest>`, with neither part empty.
        let rest = key.strip_prefix(b"user/")?;
        let slash = rest.iter().position(|&byte| byte == b'/')?;
        let (owner, rest) = (&rest[..slash], &rest[slash + 1..]);
        if owner.is_empty() || rest.is_empty() {
            return None;
        }
        Some(Key::User { owner, brand: rest == b"brand" })
    }
}

/// A lot value, `<holder>@<price>`: the holder is an address and the price a
/// canonical decimal of at least 1.
pub fn lot_value(value: &[u8]) -> Option<(&[u8], u64)> {
    let (holder, price) = holding(value)?;
    let price = price.filter(|&price| price >= 1)?;
    is_address(holder).then_some((holder, price))
}

/// A building value, `<floors> <style> <at>`: 1 ≤ floors ≤ `MAX_FLOORS`, a
/// known style, and `at` a canonical decimal.
pub fn building(value: &[u8]) -> Option<(u64, &[u8], u64)> {
    let mut parts = value.split(|&byte| byte == b' ');
    let floors = decimal(parts.next()?).filter(|floors| (1..=MAX_FLOORS).contains(floors))?;
    let style = parts.next().filter(|style| STYLES.contains(style))?;
    let at = decimal(parts.next()?)?;
    parts.next().is_none().then_some((floors, style, at))
}

/// The burn for the floor above `floors`: `FLOOR_BASE × FLOOR_GROWTH^(floors − 1)`.
pub fn floor_cost(floors: u64) -> Option<u128> {
    let growth = (FLOOR_GROWTH as u128).checked_pow(u32::try_from(floors.checked_sub(1)?).ok()?)?;
    (FLOOR_BASE as u128).checked_mul(growth)
}

/// The action in the body on `<prefix><coordinates>`. Consensus allows at
/// most one per key.
fn find<'a>(body: &Body<'a>, prefix: &[u8], coordinates: &[u8]) -> Option<Action<'a>> {
    for action in body.actions()? {
        let action = action?;
        if action.key.strip_prefix(prefix) == Some(coordinates) {
            return Some(action);
        }
    }
    None
}

/// A lot write; returns the burn it owes.
fn check_lot(body: &Body, action: &Action, lot: &Lot) -> Option<u128> {
    // The new value carries a holder and a price; deleting is refused.
    lot_value(action.new_value?)?;
    let Some(old) = action.old_value else {
        // A claim: the same transaction creates the building at one floor.
        let created = find(body, b"bld/", lot.coordinates)?;
        if created.old_value.is_some() || building(created.new_value?)?.0 != 1 {
            return None;
        }
        return Some(lot.price as u128);
    };
    let (holder, price) = lot_value(old)?;
    // The old holder may do anything; anyone else is buying, at the price
    // `check_payments` holds them to.
    body.check_token_write(action, |_| Some(()))?;
    if body.is_signer(holder).is_some() {
        return Some(0);
    }
    // Paying the burn address for a lot it holds is a burn of its own, so
    // the same credit can't also pay for another burn.
    Some(if holder == BURN { price as u128 } else { 0 })
}

/// A building write; returns the burn it owes.
fn check_building(body: &Body, action: &Action, lot: &Lot, now: i64) -> Option<u128> {
    let (floors, _style, at) = building(action.new_value?)?;
    // Only the lot's holder builds, shown by an action on the lot.
    let deed = find(body, b"lot/", lot.coordinates)?;
    body.is_signer(lot_value(deed.new_value?)?.0)?;
    let Some(old) = action.old_value else {
        // Created with its lot, at one floor.
        if floors != 1 || deed.old_value.is_some() {
            return None;
        }
        recent(at, now)?;
        return Some(0);
    };
    let (old_floors, _, old_at) = building(old)?;
    if floors == old_floors {
        // A restyle: free, and the building keeps its rank.
        return (at == old_at).then_some(0);
    }
    if floors != old_floors.checked_add(1)? || at == old_at {
        return None;
    }
    recent(at, now)?;
    floor_cost(old_floors)
}

/// `at` is within `TIME_WINDOW_MS` of the block's timestamp, either way.
fn recent(at: u64, now: i64) -> Option<()> {
    ((at as i128 - now as i128).unsigned_abs() <= TIME_WINDOW_MS as u128).then_some(())
}

fn check_user(body: &Body, action: &Action, owner: &[u8], brand: bool) -> Option<()> {
    body.is_signer(owner)?;
    // The owner may delete their own records.
    let Some(value) = action.new_value else {
        return Some(());
    };
    if !brand {
        return (value.len() <= USER_MAX_BYTES).then_some(());
    }
    (value.len() <= BRAND_MAX_BYTES && !mentions_svg(value)).then_some(())
}

/// Whether a brand mentions `image/svg`, in any letter case and with the
/// slash spelled plainly or JSON-escaped (`image\/svg`).
pub fn mentions_svg(value: &[u8]) -> bool {
    let matches = |needle: &[u8]| {
        value
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle))
    };
    matches(b"image/svg") || matches(b"image\\/svg")
}

#[cfg(test)]
mod tests;
