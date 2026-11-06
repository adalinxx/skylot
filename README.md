# Skylot

A browser city tycoon about advertising and height. Buy a lot, burn coin to raise your tower above the skyline, and paint a pixel-art sign the whole city can see. Every building is always for sale at the price its owner sets.

![Skylot by day](screenshots/day.png)

> **Prototype.** This is an offline, single-file prototype that tests whether the skyline race is fun. Rivals are simulated, and there is no chain or server yet.

## Play

Download or clone the repo, then open `index.html` in a browser. There's no build step and no server.

- `index.html?demo` starts with a built-up lot.
- Press `?` in the game for every control.

## Chain mode

With a Lattice node and a Skylot chain, the city's land, buildings and brands come from the chain, and your acts become writes signed through [Selfhold](https://selfhold.app/) (the page holds no key). The rules are in [docs/chain.md](docs/chain.md). Walkers, traffic, weather and the sky stay simulated in the browser. Chain mode loads ES modules, so serve the repo over http:

```sh
python3 -m http.server 8000          # from the repo root
# then open
http://localhost:8000/?node=http://127.0.0.1:29391&chain=Nexus/testnet/skylot-e2e
```

- `?node=<url>&chain=<path>` turns chain mode on. `DEFAULT_NODE` / `DEFAULT_CHAIN` near the top of the script do the same once the testnet chain is launched (empty for now).
- `?offline` forces the offline game. Without a node and chain, the page is the offline game, and it still opens from `file://`.
- **Wallet:** **Connect with Selfhold** uses Selfhold for Chrome where it's installed, else Selfhold's passkey window (wallet.selfhold.app). Coin is your account's balance on the chain; for now it comes from the operator's faucet. Until you connect, the city is read-only.
- **Handles:** owners show as their verified @handle from [Moniker](https://app.moniker.bio/), else their brand's name (cleaned so it can't pose as a handle), else their short account ID.
- **Comments:** select a building to talk about it. Each building has its own [Riposte](https://github.com/adalinxx/riposte) thread, and the city has one when nothing is selected; comments are signed in Selfhold's window and need no coin. Riposte runs on its own chain, so offline play has comments too: one thread, **Talk about Skylot**, shared by everyone. No moderators are set yet.
- Rivals, sign rentals, banner planes, fireworks, the blimp, taxi ads and the plaza auction are offline-only until they're on chain.

## Controls

| | Mouse & trackpad | Keyboard | Touch |
|---|---|---|---|
| Pan | Drag; sideways scroll | W A S D / arrows (Shift = fast) | One finger |
| Zoom | Scroll or pinch, toward the pointer | `+` / `−` | Pinch |
| Turn the city | ⟲ / ⟳ (the compass turns back to north) | Q / E | Twist |
| Select | Click; double-click zooms in | F focus, Esc deselect | Tap |
| Other | | H recentre, R raise your building, ? help | |

## What's in it

- **Land and height:** lots are priced by location. Each floor costs more coin to burn than the last, and the skyline board ranks everyone's tallest building.
- **Signs are art:** you paint your sign in a pixel editor, with no words. The only text ad is a banner towed by a plane, at 3 coin a letter. Other sky ads include taxi-top ads, the blimp, the plaza billboard and fireworks.
- **Marketplace:** every building is always for sale at its owner's price, with no taxes or fees. A bought building keeps its skyline rank, and bots and people play by the same rules.
- **A living city:**
  - Walkers on the sidewalks.
  - Traffic with signals, buses, bikes and rush hours.
  - Weather, seasons and a day/night cycle.
  - Parades, markets and marathons.
  - Planes and a blimp flying in front of the skyline.
- **Turning:** the view turns in quarter steps, so you can see signs hidden behind towers.

| | | |
|---|---|---|
| ![Night](screenshots/night.png) | ![Marketplace](screenshots/market.png) | ![Turned](screenshots/turned.png) |
| ![Winter](screenshots/winter.png) | ![Rainy street](screenshots/street.png) | ![Controls](screenshots/help.png) |

## Docs

- [Game brief](docs/game-brief.md): the design on one page.
- [Dev notes](docs/dev-notes.md): rules, rendering, performance, demo URL parameters and the playtest questions.
