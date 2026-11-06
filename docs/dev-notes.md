# Skylot — offline prototype

PROTOTYPE - NOT FOR PRODUCTION. Throwaway build, never shipped or deployed.

## Hypothesis

From [`game-brief.md`](game-brief.md), build order step 1: **the skyline race is fun on its own.**
Buying a lot priced by location, burning coin to rise, and watching your sign
climb the skyline, while rivals race you, makes a player want to play one more day.

## How to run

Open `index.html` in a browser. No build step, no server, no chain. (To play on a chain, see **Chain mode** below.)

- Tap a lot to see its price; buy it once grinding has earned enough.
- Select your building to put up a sign, change style, or raise it (button or `R`).
- Tap a rival's building to rent their sign for your ad.
- See **Controls** below, or press `?` in the game. `index.html?demo` starts with a built-up lot.

## Controls

Researched against city builders (Cities: Skylines, Factorio and OpenRCT2 key maps) and web canvas and map apps (tldraw, Figma, Google Maps), plus MDN on wheel, pointer and `touch-action`.

| | Mouse & trackpad | Keyboard | Touch |
|---|---|---|---|
| Pan | Drag with any button; sideways two-finger scroll | W A S D or arrows (Shift = fast) | One-finger drag |
| Zoom | Wheel, one step per notch, toward the pointer; pinch zooms smoothly and settles on a step | `+` / `−`, PageUp / PageDown | Pinch |
| Turn the city | ⟲ / ⟳ buttons; the compass between them turns back to north-up | Q / E | Twist past 45° |
| Select | Click (double-click zooms in on that spot) | F focuses the selection, Esc deselects | Tap (an 8px slop separates taps from drags) |
| Other | `?` button: the controls overlay | H / Home recentres, R raises your building, ? opens help | |

- Wheel events can't reliably tell a mouse from a trackpad. So ctrl+wheel (which is how a trackpad pinch arrives) zooms continuously, sideways scroll pans, and vertical scroll is summed into zoom steps so a trackpad isn't twitchy.
- Zoom eases between steps, and sprites are cached per step, so the view is pixel-crisp once it settles. Turning cross-fades the previous frame for about 240 ms. Both easing and the cross-fade are off under `prefers-reduced-motion`.
- Keys are ignored while typing in a field or when Cmd, Ctrl or Alt is held, so browser shortcuts like Cmd+R still work. A clamp keeps part of the city on screen.
- First visit: the hint bar shows the basic controls for 25 seconds.
- Not done: rebinding keys, pan inertia, and a trackpad "scroll pans" setting.

## What is simulated

- **Chain writes:** coin is burned at once, and the change lands after a short delay (`CFG.writeDelayMs`), standing in for the roughly one-minute Lattice confirmation.
- **Coin:** grinding for a sponsor pays a flat `CFG.grindPerSec`.
- **Other players:** six AI rivals with their own income buy land and raise buildings.
- **Rent offers:** at the end of each day, a sign of 3+ floors may get an offer from a rival, priced on height and main-street frontage.
- **Human views:** a view counts when a sign is drawn as a legible label on another player's screen, at most once per `CFG.humanViewEverySec` per sign. Offline there are no other players, so your count stays at 0; rivals' counts come from your screen.

All tuning values are in the `CFG` block at the top of the script.

## Rules added while iterating

- **Skyline board (replaces the views board):** ranks each owner's tallest building. Ties go to whoever reached that height first. The top bar shows how many floors you need to pass the next rival, and the log announces when you pass or get passed.
- **Human views only:** Curios no longer count views; they are street life, drifting toward tall buildings and main streets. Simulated views are worthless to an advertiser, so the only view metric is real players' screens. The earlier "outshine" rule (Curios look at the tallest sign) was removed with it.
- **Sign reach removed:** signs no longer have a tile radius; height matters through the skyline board and visibility on screen. Walkers no longer talk.
- **Goals:** nine ordered height goals, three shown at a time, from first lot to tallest in town.
- **Feedback:** floors grow smoothly, burns float "−N coin", rank changes pop "#N", and rent pops "+N".
- **Readability:** signs draw in their own layer; colliding labels nudge up or shrink to a dot. Hovering a lot shows its price.
- **Speed toggle:** 1× or 3× for playtesting.

## Graphics

Browser-only, drawn on a 2D canvas with no assets.
- **Day/night cycle:** each game day runs dawn → day → dusk → night. Sky and light color shift, stars come out, and windows, street lamps and storefronts light up.
- **City:** asphalt roads with lane lines, a yellow-lined main street, crosswalks at intersections, sidewalks, grass lots with trees, and street lamps with light pools at night.
- **Buildings:** each style (glass, brick, stone) has its own window pattern. Buildings have cast shadows, storefronts with awnings in the brand color, and rooftop AC units and water tanks. Towers of 7+ floors get a blinking antenna, and beacon towers get a light beam. A floor that is publishing shows as dashed scaffolding.
- **World edge:** countryside with trees and a lake fades into the sky through a soft fog layer.
- **Signs:** neon billboards on posts, glowing brighter at night.
- **Curios:** small walking people with shadows.
- Add `?t=0.3` (day), `0.67` (dusk) or `0.86` (night) to the URL to set the time of day.
- **Taxis** drive the streets with rooftop ads; click one to rent its ad. **Planes** cross the sky towing fabric banners; "Fly your banner" books one. Both count human views like signs.

## Spectacle and variety

- **Weather days:** each day rolls clear, rain, fog or storm (`CFG.weather`). Rain makes neon glow brighter. Fog hazes the whole city. A storm grounds banner planes and flashes lightning. The day chip shows the weather icon.
- **Fireworks:** 🎆 burns coin for a show over your tallest roof. Rivals sometimes celebrate at night, and the whole city sets off fireworks when the #1 skyline spot changes hands.
- **Plaza billboard:** a giant screen with chase lights over the central intersection. It's auctioned daily: the highest bid wins tomorrow's slot, and beaten bids are refunded. Click the screen to bid.
- **Blimp:** circles the city all day with a brand band on its side. Click it to rent it for 2 days.
- **Rooftop upgrades:** a garden at 5 floors, an antenna at 7, a helipad at 9 and a spire at 12. The log tells you when you unlock each one.
- **Goals:** 15 in total, adding fireworks, the plaza, the blimp and the helipad.
- **Screenshot knobs** (with `?demo`): `still` freezes time, `wx=rain|fog|storm` sets the weather, `fw` launches fireworks mid-burst, and `zoom=2` centers on your plane.

## Art and life

- **Signs are art only, no words.** Building signs, the blimp and the plaza screen each show a 32×16 pixel drawing in a neon frame. Building signs are drawn at 1.25 px per art pixel.
- **Taxis:** the coloured rooftop board is the ad. There are no floating labels over cars, and views count on the car itself.
  - Each rival has its own picture: tower, bulb, noodles, tulip, diamond, croissant.
  - Your brand's name still appears on the skyline board and in panels.
  - The editor paints with a 16-colour palette: drag to paint, right-click to erase. You can start from a template.
- **Banner flights are text only.** The one ad with words costs `CFG.bannerPerChar` (3) coin per letter, with spaces free, up to 28 characters. "✈ Fly a banner" opens a panel with live letter count and cost. Rival planes fly slogans.
- **Rooftop decor:** a brand flag, pool, neon trim, statue or satellite dish. These are cosmetic, and one more unlocks for every 3 goals completed.
- **Sound:** generated in the browser with Web Audio, so there are no audio files.
  - Ambient traffic gets louder as you zoom in and quieter at night. Rain hisses, and storms bring thunder.
  - Taxis honk, and birds chirp by day.
  - Building sounds like construction clanks, coin burns sound a chime, and fireworks whistle and pop.
  - It starts on your first click, and the 🔊 chip toggles it. The setting is remembered in the browser.
- **Life:**
  - Sailboats circle the lake.
  - A flock of birds circles the tallest tower by day.
  - When a building takes #1, Curios crowd the streets around it and jump for about 45 seconds.
- **Streets:** street tiles have sidewalks with curbs wherever they meet a lot. Walkers keep to one sidewalk, keep their side around corners, and sometimes cross at crosswalks.
- **Movement:**
  - Walkers move at about 0.32 tiles/s, and each walker varies by ±20%.
  - Taxis cruise at 1.7 tiles/s, about 5× walking pace. They accelerate, brake into turns, ease through intersections and keep a gap to the car ahead.
  - The lane offset eases through turns.
  - In a 60-second simulated test, taxis averaged 1.3 tiles/s, stood still 3.5% of the time, and walkers were off the sidewalk 0.03% of the time.
- **Screenshot knobs:** `?demo&art` turns on your art sign, decor and the editor. `&crowd` starts a crowd at Atlas Tower.

## Marketplace

Decisions (2026-11-05):
- Bots and people play by the same rules, because coin is proof of work.
- Every building is always for sale at its owner's price.
- No taxes or fees.
- A bought building keeps its full skyline rank.
- No hoarding limits.

- **Always for sale:** every owned building has a price set by its owner, and anyone can buy it at that price at any time. The seller gets the whole price. A very high price effectively takes a building off the market, at no cost.
- **Sales are chain writes:** the buyer pays when buying; the coin is held until the write lands. While any write on a lot is confirming (a sale, a raise, a price change), nothing else can act on it, so the first write to confirm wins. If the price changed before a purchase landed, the buyer is refunded in full.
- **Skyline rank carries over:** a bought building keeps its floors and the time it reached its height. The buyer's own sign goes up, and decor stays. A rival renting the sign keeps the rental, and the rent goes to the new owner.
- **Your price:**
  - A new building starts at `CFG.askDefault` (2×) the coin burned into it.
  - Each raise adds that floor's cost × 2.
  - Set any price from the building panel; a change is a write and confirms like one.
  - The panel says when a rival might buy at your price.
- **Rivals:**
  - Each rival prices its buildings at a fixed markup of 1.4× to 2.5× (1.4× more for the #1 tower).
  - Each day, each rival values buildings at a random 1.2× to 2.6× the coin burned into them, more for main street and for #1. It buys at most one building a day when a price is under its valuation. That includes yours.
- **🏷 Buy & sell** (HUD) lists buildings cheapest first, with price over coin burned, plus your own buildings and recent sales. "Show" jumps to a building. The tooltip and the building panel show the price and the last sale.
- **Checked:**
  - A trade moves coin between players and creates or destroys none (drift 0).
  - A purchase that loses a race to a price change is refunded, and the owner keeps the building.
  - In an 8-day simulation, rivals traded about every two days, before rival demand was raised to its current level.
- **Knob:** `?demo&market` opens the marketplace.

## Turning the city

- **⟲ / ⟳** in the View chip, or **Q / E**, turn the city a quarter turn about the point the camera frames. `?demo&rot=1..3` opens at an angle.
- `iso()` and `step()` rotate tile coordinates before projecting, so everything drawn through them turns with the city. Depth sorting and picking use the rotated coordinates too (`dsum`, `unproject`).
- Cached sprites and the ground layer are per angle. For two frames after a turn, the redraw budget is unlimited, so nothing shows the old angle.
- Planes are side-view drawings. In a quarter turn, they're drawn at the nearest angle where their path still reads as horizontal, and planes still on the runway aren't drawn.

## Sky ads fly in front

- The blimp, planes and their banners are drawn after building signs, the plaza screen and taxi tops, so they pass in front of them.
- A ground ad more than half covered by the blimp, a plane or a banner (as of the previous frame) isn't legible, so it counts no view. Sky ads themselves always count when on screen.

## A living city

- **Clock:** a game day maps onto 24 hours, with dawn at 05:30, and the day chip shows the time. **🕒 Local time** (View chip) makes the light follow your own clock; game days still run as before.
- **Rush hours:** walkers (up to 90) and private cars (up to 14) follow `busy()`. It peaks at 08:15 and 17:45 and drops to about 10% after midnight. Storms keep people in.
- **Walkers:**
  - They step out of building doors and fade in, and go back inside at the end of their walk.
  - Some stop to look up at signs, and a few gather under the plaza screen.
  - In rain, most carry umbrellas, and about 1 in 12 walks a dog.
  - People sit on benches beside the parks by day.
- **Traffic lights** at every junction with three or more roads (`CFG.signalCycleSec`):
  - Cars stop at the line on red.
  - Walkers wait for the walk signal before crossing.
  - Police cars run the lights.
- **Vehicles:** all share one driving model, with braking, following distance, signals and lane easing.
  - Taxis carry ads.
  - Private cars arrive and leave by a highway off the east and north edges.
  - A bus keeps to the main streets and stops at four shelters, where people queue.
  - Delivery vans pull over with hazards blinking.
  - Bikes ride near the curb.
  - Now and then a police car runs through with a siren.
- **Airfield:** banner planes take off from a runway in the countryside and pick up their banner once airborne. Half the rival planes still fly in from the edge.
- **Buildings:**
  - Window lights follow occupancy. Offices light from 9 to 6; homes in the evening, going dark after midnight. Each building runs up to 1.5 h off the clock, so lights switch one or two at a time.
  - Shops roll out awnings at 08:00 and pull down shutters at 21:30.
  - Glass towers reflect the sky, and far buildings fade into haze, more on fog days.
- **Construction:** a floor being published gets scaffolding, a slewing tower crane with a swinging load, workers on the deck, and work lights and welding sparks at night.
- **Rooftops:** steam from vents (more in winter), and pigeons that scatter when a plane passes overhead.
- **Night:** silhouettes move behind lit windows.
- **Light:** shadows follow the sun, long and west at sunrise, short at noon, long and east at sunset. Buildings have soft contact shadows at their base.
- **Weather:**
  - Each weather change blends over about 10 seconds.
  - Fog lifts toward midday.
  - Rain wets the streets. There are puddles that mirror the sky, and sign and lamp colours reflect on the road. The streets dry over about a day.
  - Clouds drift with the wind, and their shadows slide over the city.
- **Wind:** a direction and strength each day, gusting, and strong in storms. Trees sway (five pre-leaned sprite frames), rooftop flags point downwind, and rain slants.
- **Seasons** turn every `CFG.daysPerSeason` (3) days:
  - Spring: blossom.
  - Autumn: orange and red trees, and yellowed grass.
  - Winter: snow on the ground and roofs, bare trees, snow-capped pines, a frozen lake, and snow instead of rain.
- **Street life:** the busiest quarter of building fronts grows cafe tables, flower stands or food trucks while shops are open.
- **City events**, every other day:
  - A parade down Main Street (10:00–13:30), with a float showing the #1 brand's art, a marching band and confetti.
  - A market on the empty lots by the plaza (08:00–18:00).
  - A marathon round the ring road (07:00–11:00).
  - Event streets close to traffic, and events draw walkers.
- **Sound** is placed in the scene. Honks, sirens and construction clanks pan with their screen position and get quieter away from the cursor.
- **Tilt-shift** (View chip): a CSS blur at the top and bottom of the screen makes the city look like a model.
- **Knobs:** `season=spring|summer|autumn|winter`, `event=parade|market|marathon`, and `zoom=2&at=8,4` to centre on a tile.

## Performance

Canvas 2D with caching (all in the RENDER section's header comment):
- **Static ground layer:** sky, terrain, roads, countryside trees, fog and night light pools are drawn once to an offscreen canvas and blitted each frame. The layer is rebuilt only when lighting, land ownership, window size or zoom changes, or after a pan past its 320 px margin.
- **Sprite caches:** buildings, trees (shared by look), sign labels, beams and banners are drawn once at device resolution and stamped with `drawImage`. At most 8 stale sprites are redrawn per frame.
- **Cheap effects:** there are no per-frame blurs or radial gradients. Glows are pre-rendered sprites, and the vignette is CSS.
- **Crispness:** the pixel ratio is capped at 2, sprites snap to device pixels, the camera stays on integer positions, and text renders inside sprites at full resolution. While zooming, cached layers scale, then redraw sharp 180 ms after the wheel stops.
- **Second pass** (from `reports/Browser game rendering performance.md`):
  - The main canvas and the ground layer are opaque (`alpha:false`), so blitting the ground is a copy, not a blend.
  - Walkers, taxis and the blimp body are cached sprites. Walkers share sprites by look and walk frame.
  - Fireworks draw one path per colour and alpha bucket. Rain parameters are precomputed.
  - The plaza halo is baked into the ground layer.
  - Moving objects are culled before sorting and merged into a presorted static list.
- **Crispness:**
  - The canvas is sized from its exact device-pixel box, using ResizeObserver `device-pixel-content-box`, with a rounding fallback on Safari.
  - A pixel-ratio change re-renders the caches.
  - The camera snaps to device pixels.
  - Zoom moves along a fixed ladder of 8 steps per doubling.
  - Labels re-measure once fonts load.
  - The canvas now has an explicit CSS size. Before, its display size followed its pixel buffer, which on a 2× screen would have shown the city at double size.
- **Frame pacing:**
  - The simulation runs in fixed 1/60 s steps.
  - Rendering is capped at 60 fps on fast displays (`?fps=120` lifts the cap) and drops to 30 fps when the window loses focus.
  - The time step is clamped after a hidden tab returns.
- **Measuring:**
  - Press `P` (or add `?perf`) for frame interval p50/p95/p99, draw() p50/p95, a jank count, long animation frames (Chromium), pixel ratio and backing size. The frame interval includes GPU and compositor time that the draw() timer misses.
  - `window.__curio.perfStats()` returns the same numbers.
  - `?demo&still&bench` times 120 draws with a forced raster flush and logs `CURIO_BENCH` to the console, for headless or CI comparisons.
- **Measured** (headless Chrome, software rendering, built-up demo city, median of 3 interleaved runs, before → after this pass):

  | Scene | 1× | 2× |
  |---|---|---|
  | Day | 1.9 → 1.3 ms | 4.5 → 3.2 ms |
  | Rain | 1.8 → 1.3 ms | 4.9 → 3.7 ms |
  | Night | 3.1 → 2.0 ms | 9.7 → 5.4 ms |
  | Storm with fireworks | 4.8 → 2.6 ms | 14.3 → 8.1 ms |

  Single runs vary by up to 2×, so only compare interleaved medians. Headless numbers are relative only; profile on a real GPU and a low-end phone before deciding on WebGL.
- **Third pass (after the living-city features):**
  - The new features had made frames up to 3.5× slower. Each draw function was profiled with a raster flush around it.
  - Two causes:
    - `imageSmoothingQuality = 'high'` made every scaled glow a costly resample.
    - The per-tree skew transform for wind sway took the slow drawing path.
  - Fixes:
    - Low smoothing quality: sprites draw 1:1, and glows are soft anyway.
    - Five pre-leaned tree frames instead of a skew per tree.
    - Cloud shadows cached at final size and kept near the cloud's own size.
    - Benches cached as sprites.
    - Fewer banner slices.
    - Additive lights (headlights, brake lights, signals, lamps) queued and drawn in one composite pass.
    - Vehicle positions cached once per tick for car-following.
  - The simulation costs 0.024 ms per tick.
  - Medians of 3 interleaved runs, same setup as above:

  | Scene | Before features | With features | Optimized |
  |---|---|---|---|
  | Day 1× / 2× | 1.3 / 2.9 ms | 3.6 / 10.2 ms | 1.7 / 3.1 ms |
  | Night 1× / 2× | 1.8 / 5.2 ms | 3.2 / 9.0 ms | 1.6 / 3.6 ms |
  | Storm with fireworks 1× / 2× | 2.9 / 7.1 ms | 4.3 / 14.3 ms | 2.3 / 5.6 ms |

- **Tried and dropped:**
  - A half-resolution layer for large additive glows. It was 16% slower, because glows span most of the screen.
  - Drawing the ground from an ImageBitmap. No gain.
- **Production path:** if the world grows to thousands of buildings or multiple districts on screen, move rendering to WebGL (for example PixiJS) with a texture atlas. The cache-by-key design maps directly onto GPU textures.

## Chain mode

`index.html?node=<url>&chain=<path>` (or `DEFAULT_NODE` / `DEFAULT_CHAIN` near the top of the script, empty until the testnet launch) reads the city from a Lattice chain; `?offline` forces the offline game. The records and rules are in [`chain.md`](chain.md).

- **Serving:** chain mode imports `client/skylot.mjs`, `client/state.mjs` and `app/vendor/` (the Lattice SDK, Selfhold, Moniker; Riposte in the comments frame), which browsers won't load from `file://`. Run `python3 -m http.server 8000` from the repo root and open `http://localhost:8000/?node=…&chain=…`. From `file://` the panel says so. Offline mode never needs the modules (over http it loads `client/skylot.mjs` only for `safeLink`) and loads none of the vendored apps.
- **Bridge:** a `<script type="module">` at the end of `index.html` exposes `window.SkylotChain` (`city`, `balance`, `fee`, `wallet`, `walletKind`, `address`, `connect`, `disconnect`, `perform`, `handles`, `label`, `handleURL`). The classic script maps `city()` into `state.lots` every 5 s and after each write: your wallet's address becomes `'you'`; other owners get a `RIVAL[address]` entry from their brand (or a short address, a colour and a template sign), so every view of an owner works unchanged.
- **Writes:** buy an empty lot → `claim` (listed at `CFG.askDefault` × its burn), raise (button or `R`) → `raise`, style → `restyle`, Set price → `reprice`, Buy building → `buy` (relisted at `CFG.askDefault` × the price paid), Update sign → `setBrand`. Each goes to Selfhold's `writeRecords(request, { account })`. The request is `client/skylot.mjs` `writeRequest` without `fee` (Selfhold sets it: at least the host's `minRelayFee`) and with `coinOnly: true`, so burns and payments come from the account's coins and no fee sponsor is asked. Selfhold's error codes (PopupBlocked, Closed, Declined, AccountChanged, NotConnected, NeedsCoins, NoWallet…) are logged as plain sentences. The lot shows its pending label until every key the write named holds its new value; a refusal or a 3-minute timeout logs `explain()`'s sentence. A wallet that never answers is reported as "may still land" and never resubmitted.
- **Wallet:** Selfhold's client with `use: "auto"`: Selfhold for Chrome where installed, else Selfhold's passkey window; `hosts` is the chain node; no sponsor. The panel's **Connect with Selfhold** (only from a click) and **Disconnect**; the connected account shows as its Moniker label.
- **Handles:** one Moniker read (`handlesOf`) for every owner when the owners change, or once a minute, from the hosts Nexus lists for Nexus/moniker. Names come from Moniker's `label`: the verified @handle, else the brand's name as `displayName` cleans it (no `@` or look-alikes, bidi or zero-width characters), else the short ID. They show in the Owner row, marketplace rows, the skyline board, the hover tooltip, recent sales and the link row. A verified owner's Moniker page (`https://app.moniker.bio/#/@<handle>`) opens only through the panel's domain-and-**Open link** row. If Moniker can't be read, names fall back without a word.
- **Comments:** selecting a building shows **Talk about this building**, its own card after the panel (renderPanel never rebuilds it). `riposte.js` mounts once per document, so each thread is a same-origin frame, `app/comments.html?page=skylot/<chain path>/lot/<x>,<y>`, made anew only when the selected building changes. Riposte keeps its own chain, hosts and fee sponsor; comments are signed in Selfhold's window and paid with the device's work. `data-moderators` is empty for now: the operator will choose a moderator account later.
- **Vendored (app/vendor/):** `selfhold.mjs` + `selfhold.LICENSE` (selfhold-wallet 4d4c0a8, copied from Riposte); `moniker/` (moniker-sdk v0.5.0 at b06b714, the reader Riposte vendors, with its LICENSE); `riposte/` (adalinxx/riposte at b0a934e, see `riposte/PROVENANCE.md`); `lattice-sdk.js`.
- **Testing without a wallet:** define a stand-in `window.lattice` (`isLatticeWallet: true`, `connect()`, `address()`, `disconnect()`, `writeRecords(request)`) before the page loads, which Selfhold's client takes as Selfhold for Chrome, for example with Chrome DevTools Protocol's `Page.addScriptToEvaluateOnNewDocument`. `window.__curio.chain` and `window.__curio.chainSync()` expose the page's chain state.
- **Off in chain mode:** the AI economy (`rivalsAct`, `rivalsTrade`, `repriceRivals`, rent offers), seeded rival buildings, sign rentals, banner flights, fireworks, blimp and taxi ads and the plaza auction, and the goals that need them. Ambient planes, the blimp and fireworks for a new #1 still fly.
- **Signs:** the sign editor takes an uploaded PNG, JPEG or WebP (decoded, scaled to at most 96 px, re-encoded as WebP or PNG under 24,000 bytes; SVG is refused) or pixel art, plus an optional https link. Signs draw a picture from a decoded `ImageBitmap`, never from markup. Selecting a building whose sign has a link shows its domain and an **Open link** button. Both work offline too, locally.

## Status

In progress: ready for a first playtest.

## Findings

To fill in after playtesting. Questions to answer:
- Does the first lot feel reachable fast enough (target: about 5 minutes)?
- Is raising a floor satisfying, and does climbing the board make the payoff visible?
- Does the height race give a reason to come back, or do rivals run away with the top spots?
- Human views need other players: measure them only once two clients share a world (testnet step).
- Is renting signs, in either direction, interesting or noise?
