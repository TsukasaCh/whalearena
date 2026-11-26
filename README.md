# 🐋 Whale Arena — Perp Trading Game

An **online, real-time perp-trading game** you play with friends. **13 tradable
markets** (BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, TRX, TON, PEPE and the
game's own **RCLD** token) — each
with its own live price, order book, bot crowd and **~3 months of candle history**
— and two roles:

- **👤 Traders** register/login, land on an **OKX-style Home dashboard** (equity,
  total & realized PnL, win rate, a **live markets ticker** with sparklines, all
  **open positions** across pairs, **pending limit orders**, recent trades and the
  leaderboard), then enter any market to open leveraged Long/Short positions —
  **market, resting limit, iceberg, TWAP or VWAP orders** — with SL/TP they can edit
  on the fly, plus a **trailing stop**. The same order types work on the **Spot**
  venue, where every token also shows its **market cap**. Profitable trades can be
  shown off with a **shareable PnL card** (download PNG / native share).
- **🐋 The Whale (Host / God Mode)** paints the candles of any market — pump, dump,
  wick-hunts, chop — to sweep every trader's stops & liquidations and harvest margin.

Everyone connected sees the **same live market**: when the Whale manipulates
price, every trader's chart moves instantly. Real traders' liquidation prices
show up on the Whale's liquidity map as huntable targets (👤).

> Educational game — not real money, not financial advice.

---

## 🚀 Run it

```bash
npm install
npm start          # builds the app and serves everything on http://localhost:8787
```

Open **http://localhost:8787**. That single Node server hosts the web app, the
REST auth API, and the realtime WebSocket — one port, easy to share.

**Dev mode** (hot reload) uses two terminals:

```bash
npm run server     # terminal 1 — backend on :8787
npm run dev        # terminal 2 — Vite on :5173 (proxies /api and /ws to :8787)
```

Then open http://localhost:5173. Requires Node 18+.

---

## 🐳 Deploy with Docker (Ubuntu server)

The repo ships a multi-stage `Dockerfile` + `docker-compose.yml`. `docker compose up`
brings up **two containers**: a **PostgreSQL 16** database (`db`) and the Node app
(`whale-arena`), which waits for the DB to be healthy and connects automatically via
`DATABASE_URL` — no manual database setup. **Accounts persist in a named volume**
(`whale-db` → Postgres data dir), so redeploys don't wipe balances.

**One-time setup on the server** (Docker + Compose plugin):

```bash
curl -fsSL https://get.docker.com | sh
```

**Deploy:**

```bash
git clone <your-repo-url> whale-arena && cd whale-arena
cp .env.example .env         # then edit .env → set a secret WHALE_HOST_CODE
docker compose up -d --build
```

The app is now on **`http://<server-ip>:8787`**. Traders go to `/` (→ `/play`); you
log in at `/whale-god` with the code from `.env`.

Common operations:

```bash
docker compose logs -f        # tail logs
docker compose up -d --build  # redeploy after `git pull` (data is kept)
docker compose down           # stop (volume/data preserved)
docker compose down -v        # stop AND delete accounts (drops the volume)
```

> **Change the port** by editing the `ports:` mapping in `docker-compose.yml`
> (e.g. `"3000:8787"`). `PORT`/`WHALE_DB` are already wired via env.

### Put it on a domain with HTTPS (recommended)

The game's WebSocket auto-upgrades to `wss` when the page is served over `https`, so
front it with a reverse proxy that terminates TLS. Minimal **Caddy** example
(`/etc/caddy/Caddyfile`) — Caddy gets a Let's Encrypt cert automatically:

```
whale.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy proxies WebSockets out of the box, so `/ws` just works. (With nginx, add the
`Upgrade`/`Connection` headers on a `location /ws` block.)

---

## 🗺️ Pages / routes

The app is a single SPA with three entrypoints (every path serves the app, so
deep links work):

| Route | Who | What |
| --- | --- | --- |
| `/` | everyone | **Landing page** — marketing/intro with a "Main Sekarang" CTA. |
| `/play` | traders | **Trader login / register.** The only login players ever see. |
| `/whale-god` | you (host) | **God Console — admin login.** Separate, unlinked endpoint gated by the admin code. |

Traders only ever get the trader login — the whale/admin login is **not linked
anywhere** in the public UI. Share `/` (or `/play`) with friends and keep
`/whale-god` to yourself.

## 🎮 Play with friends

1. **You** start the server (`npm start`) and open **`/whale-god`** to log in as
   the **Whale (God Mode)** with the admin code.
2. **Friends** open the URL and register as **Traders** at `/` → `/play`.

**Same Wi-Fi:** friends open `http://<your-LAN-IP>:8787` (find your IP with
`ipconfig` on Windows). **Over the internet:** expose the port with a tunnel, e.g.

```bash
cloudflared tunnel --url http://localhost:8787
```

and share the printed URL.

### Admin code

The Whale/admin login (at **`/whale-god`**) is gated by a secret code. If you
don't set one, the server generates a **random code at every boot** and prints
it to the console (`Host code: …`) — so the endpoint is never left on a
guessable default. To pin your own code instead:

```bash
# Windows PowerShell
$env:WHALE_HOST_CODE = "your-secret"; npm start
```

Traders never see God Mode — it's a separate endpoint, and the page is decided
by the account role, not a toggle.

---

## 🧱 Architecture

The market engine is **server-authoritative** — it runs once on the server so
every client shares one truth.

```
server/
├─ index.js        # Express (static app + /api auth) + WebSocket hub + tick loop
├─ engine.js       # MarketHub: shared wallet + one Market per symbol, order routing
├─ market.js       # a single market: base + 3-month deep candles, bot crowd,
│                  #   cascades, MM commands, resting-limit fills, position resolution
├─ auth.js         # register / login (scrypt-hashed) + host code
├─ storage.js      # persistence adapter — PostgreSQL (DATABASE_URL) or SQLite fallback
└─ constants.js    # shared engine constants + the tradable MARKETS list

src/
├─ router.js          # tiny dependency-free router (/, /play, /whale-god)
├─ store/
│  ├─ useAuth.js       # session (token) in localStorage
│  └─ useSimStore.js   # client MIRROR of server state; actions send WS messages
├─ net/
│  ├─ api.js           # REST: register / login / host
│  └─ useSocket.js     # WebSocket: applies snapshots/deltas, reconnects
├─ lib/                # trading math, candle aggregation, liquidity, formatting, sound
└─ components/
   ├─ Landing.jsx         # public landing page at "/"
   ├─ AuthGate.jsx        # single-role login (trader at /play OR whale at /whale-god)
   ├─ TopBar.jsx          # nav bar + TickerBar (pair picker, price, funding / market cap) + timeframes
   ├─ Chart.jsx           # lightweight-charts + entry/SL/TP/LIQ lines + skull markers
   ├─ RetailPanel.jsx     # trader page: order book column + trade column (position, form, history)
   │  ├─ OrderForm.jsx / PositionCard.jsx / OrderBook.jsx     # futures: Market / Limit / Iceberg / TWAP / VWAP
   │  ├─ SpotForm.jsx / SpotHolding.jsx / SpotPending.jsx / Staking.jsx   # spot venue
   │  └─ AlgoOrders.jsx   # running TWAP / VWAP orders (futures or spot)
   └─ MarketMakerPanel.jsx# Whale page: crowd, presets, joystick, liquidity map
      └─ CrowdStats.jsx / LiquidityMap.jsx
```

### Price = order flow (impact model)

Price is **not** a random number — it's driven by order flow against book depth:
`Δprice = netFlow / rho`, where `rho` (BTC of depth per $1) scales with the number
of participants. So a small market order barely moves price, while big orders and
liquidation clusters move it proportionally, and **candle volume is the executed
flow** (they're linked by construction).

**One depth, everywhere.** `rho` comes from a single function — `depthFor(participants)`
in `server/engine.js`, mirrored in `OrderBook.jsx` — so the **order book you see is the
same liquidity the engine moves price through**. A whale pump that shifts price $X
consumes ~`X × rho` BTC of the book along its path (≈ the resting depth it crosses), and
calm turnover sits around a realistic **~30 BTC/min** rather than hundreds. Tune the feel
with `AMBIENT_FLOW` (calm churn) and `depthFor` (thicker book → calmer price but more
volume per move, since `volume = rho × price move`). Every market order — a trader's open/close,
a forced liquidation, and the Whale's **pump/dump/nudge/drive** — is real order flow
that eats the book: it fills fast and proportionally (a big whale order lands most of
its size in one candle, dragging price and spiking volume, with the tail over the
next ticks), which is what produces realistic cascades.

### Limit orders are real book liquidity (not decoration)

A resting **limit order isn't a hidden flag — it's genuine depth on the book.** Every
live limit order is broadcast and drawn at its price in the order book (marked with a
dot; **gold ◆ for your own**), so a big order literally shows up as a **wall**. When
price trades into that level the order behaves like a real maker wall:

- **It absorbs the opposing flow** (support for a buy wall, resistance for a sell wall).
  Price *stalls at the wall* and can't pass until enough flow has eaten through it — a
  big wall holds price for several ticks.
- **It fills partially, over time.** Each tick the wall soaks up only the flow reaching
  its level, so a large order fills in chunks (the position grows as it fills; all fills
  are at the limit price, so entry & liq stay put). Gentle flow → gradual fill; a violent
  market order can blow clean through and fill it at once.
- **The fills are real volume** and, once the wall is exhausted, price breaks past it.
- Cancelling refunds only the **unfilled** reserve; the filled part is already your
  position.

This is what keeps the book *connected* to the market: what you see is the liquidity the
engine actually moves price through (`depthFor()` for the ambient crowd depth, plus real
resting orders on top), not a cosmetic overlay.

Because impact is permanent, price is kept sane by a slow **fair-value anchor**: a
gentle mean-reversion pulls price back toward it over minutes and a hard band
(`0.5×…2×` the anchor) caps it, so whale moves persist for a while but the market
can never run away.

### Iceberg orders

An **iceberg** is a limit order that shows only part of its size. Pick the
**Iceberg** tab (Futures or Spot), set a limit price and size as usual, and choose
how much of the order is **visible** (1 – 50 %).

- The order book — yours, other traders' and the Whale's — only ever shows the
  visible **tip** at that price. When the tip is filled the next one appears, until
  the whole order is done; the rest stays hidden.
- The hidden size is still real liquidity: it fills at the limit price and holds
  price at that level exactly like a normal wall. It just can't be *seen* in
  advance, so a large buyer or seller doesn't advertise a wall for the Whale to
  hunt or for others to front-run.
- Everything else is a normal limit order: maker fee, margin reserved up front,
  partial fills, drag-to-reprice on the chart (drawn as an `ICEBERG` line), and
  cancel refunds the unfilled part. Pending lists tag it `Iceberg 10%`.

Server side it is one field on the resting order (`visFrac`, set by `icebergFrac()`
in `server/engine.js`); `Market.restingOrders()` publishes only the tip.

### Spot grid bot

The **Grid** tab of the Spot order form starts a grid trading bot. Pick a price
range, a number of grids and an investment; the bot splits the range into equal
steps and keeps a ladder of resting limit orders on it — **buys below the price,
sells above**. Whenever a buy fills it places a sell one level up, and whenever a
sell fills it places a buy one level down, so every completed round trip banks one
grid step minus two maker fees while price chops inside the range.

- **Start**: buy orders go on every level below the market; the coins for the sell
  ladder are bought at market up front (taker fee) and rest on the levels above.
  The level next to the price is left empty — that is where the first flip lands.
- **Isolated funds**: the investment leaves the balance and lives in the bot (idle
  USDT / coins plus what sits in its orders). It all still counts toward equity.
- **Real liquidity**: bot orders are ordinary spot limit orders — visible on the
  book and the chart (`GRID B` / `GRID S` lines), fillable by anyone, but not
  draggable and not affected by "Cancel all".
- **Out of range**: below the range the bot ends up holding coins, above it USDT,
  and waits. There is no automatic stop.
- **Stop**: cancels the ladder, returns USDT to the balance and coins to the spot
  holding (carrying whatever the bot has not paid back as their cost basis).
- The bot card shows total PnL split into **grid profit** (banked round trips) and
  **floating PnL** (the coins it still holds), plus the cycle count.

Limits: 2 – 50 grids, grid step at least 0.2 % of the lower price, about $1 minimum
per grid, one bot per symbol and five per account (`GRID_*` in `server/engine.js`).
Bots are stored in the `grids` column of the account and resume after a restart.

### Algo orders: TWAP & VWAP

A big market order eats straight through the book and pays for it in slippage.
The two algo order types work the same size as a **series of small market child
orders ("slices")** instead. Both are available on **Futures and Spot**, as tabs
next to Market and Limit in the order form.

- **TWAP** (time-weighted) — equal slices at equal intervals. The first slice fires
  immediately and the last one lands exactly at the end of the chosen duration.
- **VWAP** (volume-weighted) — the same slots, but each slice is sized by how much
  volume the market actually traded since the order started versus its recent
  average: bigger when the market is busy, smaller (or skipped) when it is quiet.
  The last slot always completes the order. Until the server has a few minutes of
  live candles to use as a baseline, VWAP paces by time like a TWAP.

How the money is handled:

| | Reserved up front | Each slice | When it ends |
| --- | --- | --- | --- |
| **Futures** | total margin + taker fee | opens / adds to the position (DCA) | unused margin + fee refunded |
| **Spot buy** | total USDT + taker fee | buys coins into the holding | unused USDT refunded |
| **Spot sell** | the coins (and their cost basis) | sells coins, proceeds go to the balance | unsold coins return to the holding; the run is booked as **one** trade |

- Reserved funds still count toward **equity** (they are locked, not spent), so
  placing an algo order never changes your total assets.
- Slices are charged to the exact amount — sub-cent fees and fractional coins are
  carried from slice to slice, so 100 tiny slices cost the same as one big order
  (apart from the better or worse prices they get).
- An order ends when it **completes**, is **cancelled**, or — on futures — when the
  position it is building is **closed, liquidated or hits SL/TP**, so it never
  rebuilds a position you just lost. A whale market reset refunds reservations.
- The **Algo orders** card (trade panel and Home) shows progress, the slice counter,
  a countdown, your **average fill** and the **market VWAP** since the order began,
  with the difference between the two — the usual way to judge an execution.

Limits: 30 s – 4 h duration, 2 – 100 slices, at least 2 s between slices, at least
$1 per slice, up to 3 running algo orders per market (`ALGO_*` in `server/engine.js`).
On futures an algo follows the same one-direction rule as every other order.

### Market cap

Each market has a circulating `supply` — and, where the coin has one, a `total`
(max) supply — in `server/constants.js`. The client shows **market cap = spot price
× circulating supply** on the Spot ticker bar (with its rank among the listed
tokens), in the Spot pair picker, and as a column in the Home **Markets** table. The
ticker bar also shows circulating / total supply and the **FDV** (spot price × total
supply) when the two differ. The supplies are rough real-world figures, except
**RCLD** — the game's own token — which has **200M circulating out of a 1B total
supply**. Edit them there.

### Candle history: real market data

A fresh market needs months of candles before anyone has traded. At boot the server
downloads each coin's **real recent history** from Binance's public market-data API
(`server/realHistory.js`: 10 days of 1-minute candles plus ~3 months of hourly
candles; no API key, nothing about players is sent) and uses it for the charts.

- Only the **shape** is taken: prices are rescaled so the last close equals the
  game's own price for that market. Positions, balances and the game's price
  levels are untouched — the chart simply shows the real moves that led "here".
  Volumes are rescaled to the game's volume scale, and both the futures and the
  spot market of a coin use the same series.
- It is **best effort**. A coin Binance does not list or no longer trades (the
  game's own RCLD, currently TON), a blocked network or a timeout leaves that
  market on generated history; the boot log says which coins got which.
- Saved markets are rebuilt once real data is available: they keep their price and
  stats and only their candle history is replaced.
- Boot waits for the download (about 10 s, capped at 60 s). Set `REAL_HISTORY=0`
  to skip it, or `REAL_HISTORY_API` to point at another Binance-compatible
  `/api/v3/klines` endpoint.

**Generated history** (the fallback) comes from `synthPath()` in `server/market.js`: a **log random walk with volatility clustering**
(quiet stretches and bursts), short-lived trends and the occasional impulse bar, plus
a faint long-horizon pull so multi-month ranges stay plausible. Because it is a walk
rather than noise around one level, **the visible price range grows with the
timeframe** — 60 candles of 15m span clearly more than 60 candles of 1m — and the
chart re-fits its price axis whenever you switch timeframe or market.

### Data flow

- On connect the server sends a **snapshot** (full base-candle history + price +
  crowd). After that it streams compact **deltas** each tick: the live candle,
  any finalized bar, liquidation events, and crowd stats.
- Clients keep the shared **1-minute base series** and aggregate it locally into
  the selected timeframe (1m…4h), so every timeframe is consistent.
- Traders send `open` / `close`; the Host sends manipulation commands. The server
  validates, resolves positions against every price move, and broadcasts results.

### Trader experience

- **Home dashboard** (`HomeDashboard.jsx`) is the landing page after login: equity,
  total PnL (vs the 10k start), realized PnL, win rate, open position, recent
  trades, and a live **leaderboard** (refreshes ~1s) ranked by equity that mixes
  the human players with the whole **bot crowd** — each bot shown with its
  nickname, side/leverage and realtime PnL. "Enter Market" opens the chart/trading
  view; the **Home / Trade** tabs switch between them.
- **Leaderboard privacy** — a switch at the top of the leaderboard lets each player
  choose whether they appear on it. A hidden player is left off the board for
  everyone (name and equity); the choice is stored with the account (`lb_hidden`
  column) and survives restarts. Trading is unaffected.
- **Chart legend** — hover any candle for an O/H/L/C + change% + Volume readout
  (top-left), plus a **volume histogram** under the candles. The highest high and
  lowest low of the visible range are labelled with their price on the wick.
- **Coin logos** — every market has a small inline-SVG logo (`CoinIcon.jsx`); add
  an entry there for a new coin, otherwise it falls back to a letter badge.
- **Click-to-trade on the chart** (OKX-style) — hover anywhere on the chart and a
  one-click chip appears at the cursor's price: **▲ Limit Long** when you're below
  the mark, **▼ Limit Short** when above (the valid maker side for that level). Click
  it to drop a resting limit **at that exact price** using the size & leverage from
  the order panel — no need to type. It appears instantly as the `LIMIT` line on the
  chart and a wall on the book. Leverage/margin are shared between the panel and the
  chart (`orderDraft` in the store).
- **Stack as many limits as your margin allows** — there's no one-order limit. Every
  resting order shows in the panel with its own ✕ (plus **Cancel all**), sits on the
  book as its own wall, and fills independently. They all share one side (the book is
  directional); flip only after closing/cancelling. As they fill they **average into
  one position** (see DCA below).
- **Drag a limit line to reprice it** — grab any *unfilled* `LIMIT` line on the chart
  and drag it up/down; on release the order moves to that price (margin & leverage
  kept, quantity recomputed). Partially-filled orders lock in place. (`moveLimit` on
  the server re-validates the maker side.)
- **Set & drag SL/TP from the chart** — with a position open, the hover chip becomes
  **✓ Set TP** (profit side of entry) or **✕ Set SL** (loss side); click to place it.
  Once set, the `SL ⇕` / `TP ⇕` lines are **draggable** — grab and drag to adjust (drag
  onto the wrong side of the mark clears it). Grabbing a line disables chart pan/zoom
  so the drag is clean.
- **Order book** (`OrderBook.jsx`) is one underlying depth profile sampled at the
  chosen **grouping** (0.1 … 1000): a bigger tick sums finer levels AND reaches
  further from the mark, so you can zoom from a close-up (±$1.6k) out to a wide
  survey (±$16k) — the header shows the range. A $100 row equals ten $10 rows and
  resting **walls stay anchored to their price** as the book scrolls, so depth /
  thickness builds up consistently. Depth scales with the number of participants.
- **Scale in / DCA** — you're not stuck with one entry at one price. Fire another
  **market or limit** order on the **same side** and it *folds into* your position:
  the entry becomes the size-weighted **average**, margin & quantity add up, and the
  liquidation price is recomputed from the blended (effective) leverage — exactly how
  a big trader builds a position across several prices instead of one lump. The order
  form previews the resulting **→ New Avg Entry** and **→ New Liq. Price** before you
  commit. (Opening the *opposite* side is blocked — close first — to keep one clean
  position per trader.)
- **Manage an open position** (`ManagePosition.jsx`) — edit SL/TP after opening,
  or set a **trailing stop** by callback %. The trailing level follows the peak
  and triggers on a pullback; it's drawn on the chart (gold `TRAIL` line) and the
  server is authoritative for the trigger. Lifetime stats (trades, wins, realized
  PnL) persist per account in SQLite.

### Timeframes

`1m · 5m · 15m · 30m · 1h · 4h · 1d` — all aggregations of the same base series, so a
bullish 1m run is a bullish 4h candle. Candles bucket by **real wall-clock time**:
a 1m candle spans one real minute (a new one appears each minute), 5m every five
minutes, and so on. Price still ticks continuously (the live candle grows in real
time) — it just doesn't spawn a new candle every couple of seconds.

---

## 🧮 The math (`src/lib/trading.js`, mirrored in `server/engine.js`)

Isolated margin, maintenance-margin rate `MMR = 0.5%`.

```
qty      = margin × leverage / entry
Long liq  = entry × (1 − 1/leverage + MMR)
Short liq = entry × (1 + 1/leverage − MMR)
pnl      = qty × (mark − entry)      # short flips the sign
```

Higher leverage → liquidation sits closer to entry → easier prey for the Whale.

---

## 🗄️ Storage

Accounts and balances persist through a small storage adapter (`server/storage.js`)
with two interchangeable backends:

- **PostgreSQL** — used automatically whenever `DATABASE_URL` is set. `docker compose`
  runs it as the bundled `db` container (Postgres 16) and points the app at it, so a
  deploy needs **zero manual database setup**. The schema is created on first boot.
- **SQLite** (`better-sqlite3`, file at `server/whale.db`, git-ignored) — the
  zero-config fallback used when `DATABASE_URL` is absent, so `npm run dev` / `npm run
  server` just work on your laptop. A legacy `server/data.json` is migrated in on first
  start. Point elsewhere with `WHALE_DB=/path/to/whale.db`.

Market state (price, stats and candle history) is saved too, tagged with a format
version (`HIST_VERSION` in `server/market.js`). When the history generator changes,
bump it: on the next boot older saves **keep their price and stats** — so open
positions resume exactly where they were — and only their candle history is rebuilt
to end on that price. Running TWAP / VWAP orders are stored with the user's books
and resume after a restart once the account is loaded again.

Passwords are scrypt-hashed. This is a **party game**, not a bank — don't reuse a
real password. Session tokens live in memory and reset when the server restarts
(players just log in again; balances persist in the DB).
