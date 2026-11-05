# Game Brief: Skylot

**One-sentence pitch:** A browser world tycoon on Lattice where you buy land, burn coin to raise your building above the skyline, and put up a pixel-art sign that the whole map can see.

## Core loop
- Buy a lot. Location sets the price, because busy streets and tall neighbors mean more eyes.
- Burn coin to add floors. Each floor costs more, and height climbs the skyline leaderboard and makes your sign easier to spot.
- Put up a sign (a picture, no words) to advertise yourself, or rent it to someone else.
- Buy and sell buildings: every building is always for sale at the price its owner sets.
- Earn coin by grinding for a sponsor, mining or renting out your sign, then buy more land or climb higher.

## Player goal & fail state — what "working" looks like
- Goal: top the skyline. The leaderboard ranks each player's tallest building. Your sign's real human views decide what it rents for. A session feels complete when you add a floor, pass a rival or land a renter.
- Fail state: no hard loss. Soft failure is overpaying for a quiet lot, or burning floors nobody sees.

## MVP — what must exist to be the game
- World map: one isometric grid of lots with streets; lot price by location
- Buy land and buildings: on-chain lot ownership, paid in coin. Every building is always for sale at its owner's price, with no taxes or fees, and a bought building keeps its skyline rank. Bots and people follow the same rules, because coin is proof of work
- Raise your building: burn coin per floor, rising cost per floor, a few exterior styles
- Skyline leaderboard: players ranked by their tallest building; ties go to whoever reached the height first
- Signs: one per building, a pixel-art picture with no words, drawn in the game; rent to other players. The only text ad is a banner towed by a plane, charged per letter. A view counts only when a sign is legible on another real player's screen. Cloudflare Turnstile checks each session is human, and a Cloudflare Worker dedupes and caps the reports, then signs daily totals onto the chain
- Curios as street life: they walk the streets and react to signs, but count nothing
- Coin: grind on any device GPU for a sponsor (no node needed) or mine with your own node; sponsors pay write fees and credit coin for the work
- Curio chain on a Lattice testnet: lots, floors and signs published, loaded from a second node

## Out of scope — not building this
- Interiors (next after the MVP), expeditions, regulars
- Uploaded images on signs (signs are drawn in the built-in pixel editor)
- Region child chains, real-time presence, mainnet or real-value economy
- Moderation of signs and names
- Chat, avatars, native desktop and mobile apps (Curio is browser-only)

## Build order
1. Offline prototype: map, buy a lot, burn to rise, signs seen from a distance, Curios walking. Is the skyline race fun?
2. Lot ownership and burns on a Lattice testnet chain
3. Signs and rentals, with human view counting through Cloudflare (Turnstile plus a Worker)
4. Sponsor grinding on device GPUs, and node mining

---
**Who it's for / what they feel:** Players who like tycoon and city-builder games. They feel the pull of a better corner, the thrill of topping the skyline, and pride when their sign is the one everyone sees.

**Art & audio direction:** Open to every kind of art, including 2D, pixel, 3D, illustration, audio and mixed media. The world's own look stays warm, readable and neutral isometric, with soft ambient music, so buildings, signs and player-made work stand out.

**Reference game:** SimCity and Monopoly for buying land and choosing locations, in RollerCoaster Tycoon's isometric view. The MVP keeps land, height and signs, and drops zoning, services and interiors.
