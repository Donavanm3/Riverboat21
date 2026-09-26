# Riverboat 21

Online multiplayer blackjack played entirely with play-money credits.

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

## Host it for free (works entirely from a phone)

| Part | Where | Cost |
|---|---|---|
| Game page (`docs/`) | GitHub Pages | Free |
| Game server | Render free web service (deploys from GitHub) | Free |
| Saved data (accounts, credits, tournaments) | Neon free Postgres (`DATABASE_URL`) | Free |

Free servers have no permanent disk, so with `DATABASE_URL` set the game keeps its whole state in one
Postgres row and reloads it on every start (`start.js`, `lib/pgsync.js`).

Free-tier trade-offs: the server sleeps after 15 minutes with no visitors, and the next visitor waits
about a minute while it wakes. Render gives 750 free hours a month, enough for one always-used service. Hands in progress when it sleeps are cancelled and their bets refunded
automatically. Tournaments that ended while it slept pay out within 15 seconds of waking.

Setup summary (full phone steps are in the chat where this was built):
1. GitHub: public repo, paste `.github/workflows/unpack.yml`, upload `riverboat21.zip`.
2. Neon: create a project, copy the connection string.
3. Render: New → Blueprint → this repo (reads `render.yaml`, Free plan). Fill in `DATABASE_URL`,
   `ADMIN_PASSWORD`, `CLIENT_URL`, `PUBLIC_URL`, PayPal keys. Render sets `PORT` itself.
4. GitHub: put the Render address in `docs/config.js`, then Settings → Pages → `main` / `/docs`.

Paid, always-on alternative: Railway (`railway.json` included, about $5/month). Any Docker host works;
with a disk you can skip `DATABASE_URL` and use `DATA_FILE`.

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

## Rules

6 decks, reshuffle at 75% penetration, dealer peeks on A/10, dealer stands on all 17s, blackjack pays 3:2,
double on any first two cards (including after split), one split per hand, split aces get one card.
