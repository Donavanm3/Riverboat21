# Riverboat 21

Free social casino: live multiplayer blackjack plus roulette, slots, crash, mines, plinko, dice, video poker and baccarat, all played with play-money credits. Website, installable web app, offline mode, and an Android/iOS app project.

- 4 live tables, 5 seats each, server-authoritative dealing (crypto-random 6-deck shoe)
- Accounts (email + password), 1,000 free credits on sign-up
- Free credits: daily bonus, rewarded ads, empty-wallet refill
- Credit store: PayPal Checkout credit packs (play credits only, no cash value)
- Tournaments hosted by the admin, live standings, automatic payout at end time
- Admin panel for `ADMIN_EMAIL`: host/end/cancel tournaments, adjust credits, suspend players, see purchases

## Run it

```bash
cp .env.example .env      # fill in JWT_SECRET and ADMIN_PASSWORD at minimum
npm install
npm start                 # http://localhost:3000
npm test                  # engine fuzz test + end-to-end server test
```

Sign in as `mcguiredonavan8@gmail.com` with `ADMIN_PASSWORD` and the Admin button appears.
The admin email is reserved: nobody can register it, even with different capitalization.

## Where it runs

| Part | Where | Cost |
|---|---|---|
| **Website players visit** (`docs/`) | **GitHub Pages**: `https://YOUR-NAME.github.io/riverboat21/` | Free |
| Online engine (accounts, multiplayer, PayPal, tournaments) | Render free web service, runs in the background | Free |
| Saved online data | Neon free Postgres (`DATABASE_URL`) | Free |

GitHub can only host static files, so the online engine still runs on Render, but players never need
its address: `docs/config.js` points the GitHub page at it, and the server accepts any `*.github.io` origin.

**Turn on the GitHub site:** repo → Settings → Pages → Deploy from a branch → `main` / `/docs`.
If your Render address isn't `https://riverboat21.onrender.com`, change it in `docs/config.js`.

### Offline mode and app install (no server needed)

The page is an installable app (PWA). Players can add it to their home screen or desktop, and
**Play offline** runs blackjack and all casino games entirely on the device with practice credits
saved in the browser. It uses the exact same engine: `docs/engine.js` is generated from `lib/`
by `npm run build` (the tests fail if it is out of date). If the online server can't be reached,
the sign-in screen offers offline play automatically. Offline mode has no accounts, store, ads,
tournaments or multiplayer, since those need the online engine.

### Hosting the website on TiniDrop

TiniDrop (tinidrop.com) hosts the game page like GitHub Pages does; the Render server keeps running the engine,
and it accepts the game page from any website by default (sign-in uses a token, not cookies, so this is safe).
Set `CORS_STRICT=true` on Render to only allow GitHub Pages, TiniDrop, the app, and `CLIENT_URL`/`ALLOWED_ORIGINS`.

- **By hand (works from a phone):** run `npm run pack:site` (or use the ready-made `riverboat21-tinidrop-site.zip`)
  and drag the ZIP onto tinidrop.com. Then open **Live Site**. ZIP sites need TiniDrop's Solo plan or above;
  free links expire after 7 days.
- **Automatically on every push:** copy `deploy/tinidrop-deploy.yml` into `.github/workflows/`, add your TiniDrop API key
  as secret `TINIDROP_API_KEY`, run it once, then save the slug it prints as repository variable `TINIDROP_SLUG`
  so later runs update the same link.
- From a computer: `TINIDROP_API_KEY=td_... npm run deploy:tinidrop`.

### Embedding in Google Sites

Google Sites can't run the game, but it can show the GitHub page inside a Google Site:
Insert → Embed → By URL → `https://YOUR-NAME.github.io/riverboat21/` → Insert, then drag the box
to full width and tall. When embedded, the game shows an "Open full screen" button (recommended for
PayPal checkout and for installing the app). If an embed blocks storage, the game keeps working and
simply forgets sign-in on refresh.

### Server setup (Render, free)

1. Neon: create a project, copy the connection string.
2. Render: New → Blueprint → this repo (reads `render.yaml`, Free plan). Fill in `DATABASE_URL`,
   `ADMIN_PASSWORD`, `PUBLIC_URL`, PayPal keys. Render sets `PORT` itself.

Free-tier trade-offs: the engine sleeps after 15 minutes with no visitors, and the next visitor waits
about a minute while it wakes (the sign-in screen offers offline play meanwhile). Hands in progress when it
sleeps are refunded automatically.

Uploading from a phone: create `.github/workflows/unpack.yml` (the unzip workflow) once, then upload
`riverboat21.zip` with Add file → Upload files; the workflow unzips it into the repo.

## Payments (PayPal Checkout)

Credit packs and paid tournament entries use PayPal Smart Buttons (PayPal balance, or debit/credit card as a guest).

1. Go to developer.paypal.com → Apps & Credentials → create an app. Copy its **Client ID** and **Secret**.
2. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENV=sandbox`. Test with a sandbox buyer account
   (Sandbox → Accounts).
3. When it works, switch to the **Live** app's credentials and `PAYPAL_ENV=live`.

How it stays safe: the server sets every price, creates the PayPal order, captures it itself, and checks the
captured amount before granting anything. Orders can only be captured by the player who created them, and a
capture is never granted twice. If an amount doesn't match, or a tournament filled up during payment, the money is
refunded automatically. Cancelling a paid tournament refunds every entry. No webhook setup is needed.
Packs and prices are in `lib/config.js`.

**PayPal policy:** PayPal's Acceptable Use Policy restricts games of chance, contests, and "internet gaming",
and it may freeze accounts that sell them without approval. Before going live, email PayPal (or open a ticket)
describing the game: play-money blackjack, credits with no cash value, and paid-entry tournaments that award
only play credits. Ask them to confirm or pre-approve it. Running this under a business account helps.

## Ads (AdSense / H5 Games Ads)

Set `ADSENSE_CLIENT=ca-pub-…` to enable the rewarded "Watch ad" button (Ad Placement API),
and `ADSENSE_BANNER_SLOT` for the bottom banner. Your site must be approved for AdSense and
H5 Games Ads. Use `ADS_TEST_MODE=true` while testing. Rewards are capped server-side
(2-minute cooldown, 10 per day, `lib/config.js`) because browser ad networks can't be verified from the server.

## Tournaments

Every entrant gets the same chip stack and number of hands vs the dealer; biggest stack at the end time wins.

| Prize | Allowed entry | Payout |
|---|---|---|
| Play credits | Free, play credits, or **real money** (PayPal) | Automatic, 50/30/20 of the credit pool |
| Real money (cash) | **Free only** | You pay winners (PayPal, etc.); admin panel shows emails and tracks pending/contacted/sent |
| Physical item / gift card | **Free only** | You ship it; same tracking |

The server refuses any tournament that combines paid entry (money or credits) with a real prize.
Paying to enter a game of chance for a prize of real value is gambling under US law, Kentucky included,
and PayPal bans it without a gaming license. Free entry with a prize you
fund is a promotional contest, which is legal when you post official rules. The admin form pre-fills a
rules template: edit in your name, contact email, eligibility, and delivery details. Players must tick
an 18+ / eligibility / rules box before entering. Winners over $600 in a year may need a 1099 from you.
I'm not a lawyer; get the rules checked before running prizes of significant value.

Paid-entry credit tournaments go through PayPal; the entry is added only after the server captures the payment.
If the tournament filled or closed during checkout, or you cancel it, entries are refunded automatically.

## Other games

All share the same credit wallet and are decided on the server (`lib/casino.js`); the browser only animates the result.

| Game | Rules | Long-run return |
|---|---|---|
| Roulette | European single zero; straight 35:1, dozens/columns 2:1, red/black/odd/even/high/low 1:1 | 97.3% |
| Slots | 3×3, 5 lines (rows + diagonals), weighted symbols; paytable in `lib/casino.js` | 96.5% (exact, tested) |
| Video Poker | Jacks or Better 9/6 paytable, royal 800× | ~99.5% with perfect holds |
| Baccarat | 8 decks, standard third-card rules; Banker pays 0.95:1, Tie 8:1 | Banker 98.9%, Player 98.8% |

A video-poker bet sits in escrow until the draw; if the server restarts in between, it is refunded.
Plays are limited to about 3 per second per player.

## Watch ads for credits

Players open **Earn credits** and tap **Watch a video** (default: 150 credits, 2-minute cooldown, 10 per day; change in `lib/config.js`).

| Where | Ad network | Setting on Render |
|---|---|---|
| Website | Google AdSense (H5 Games Ads rewarded) | `ADSENSE_CLIENT=ca-pub-…` |
| Mobile app | Google AdMob rewarded video | `ADMOB_REWARDED_ID=ca-app-pub-…/…` (+ `ADMOB_APP_ID` repo variable for the build) |

The video card only appears where ads are set up. For testing the app before AdMob approves you, use Google's
test IDs: app `ca-app-pub-3940256099942544~3347511713`, rewarded unit `ca-app-pub-3940256099942544/5224354917`.
`SIMULATE_ADS=true` shows a fake 10-second ad for trying the flow; never leave it on in production.

## Giving players credits (admin)

Admin → Players → **Give credits** (quick amounts, optional message; negative numbers take credits away), or
**Gift every player** at the top. Players see a "You got a gift" popup instantly, or the next time they sign in.
Every gift is logged under **Credit gifts**.

## Mobile app (Android, iOS)

`mobile/` is a Capacitor 8 project that packages the same game (`docs/`) as a native app pointed at your server.
In the app, the PayPal store and paid tournament entries are hidden (app stores require their own billing for
digital goods); rewarded videos use AdMob.

**Build Android from your phone (GitHub Actions):**
1. Copy `mobile/android-build.yml` into `.github/workflows/android-build.yml` (Add file → Create new file, paste).
2. Actions → **Build Android app** → Run workflow. When it finishes, download **riverboat21-android** from the run's
   Artifacts and install the `.apk` on your phone to test (allow "install unknown apps").
3. For Google Play: run the workflow once with **make_keystore** ticked, download **signing-key-SAVE-THIS**
   (kept for 1 day; store it somewhere safe forever), and add its three values as repository secrets
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`. Later runs then produce a signed
   `.aab` to upload in the Play Console ($25 one-time developer account).
Optional repository variables: `API_URL` (server address) and `ADMOB_APP_ID`.

**iOS** needs a Mac with Xcode (or a cloud Mac service such as Codemagic) and an Apple Developer account ($99/year):
`cd mobile && npm install && npm run ios:prepare && npx cap open ios`.

Store policies: list the app as a social/simulated casino (no real-money gambling), rate it 17+/Mature, and keep
real-prize tournaments' official rules in the app. Paid entry stays website-only.

## Rules

6 decks, reshuffle at 75% penetration, dealer peeks on A/10, dealer stands on all 17s, blackjack pays 3:2,
double on any first two cards (including after split), one split per hand, split aces get one card.
