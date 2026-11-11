# RideShare (uber-video-run)

A ride-hailing app for Indian cities: riders book bikes, autos and cars; drivers get verified and accept rides nearby.

| Part | Folder | What it is |
|---|---|---|
| **Web app** | `frontend/` | React + Vite, phone-width. Rider and driver screens, Ola Maps |
| **API + admin** | `Backend/` | TypeScript (Node runs it directly), Express, SQLite, Auth0 JWTs, WebSocket live updates. Admin website and a dev sign-in for testing |

Why things are built the way they are: [`Backend/decision.md`](Backend/decision.md) (round 7 is this merge).

## Features

- **Sign-in with Auth0**: Google, or email + password (sign up included). Riders and drivers each sign in in their own browser tab.
- **Onboarding**: name and phone with an SMS code. Drivers also give their licence number and expiry, vehicle make, model, year, colour and registration number, and insurance expiry, and upload licence, RC and insurance. An admin approves them before they can go online.
- **Booking**: locate-me fills the pickup; search places (Ola Maps) or tap Home/Work; see the route, fares and ETAs for bike, auto and car, and the online cabs nearby.
- **Pricing segments** (India time, fixed at booking): normal ×1, **peak** 8-11 am and 5-8 pm ×1.5, **late night** 12-5 am ×1.3. Each fare shows its breakdown.
- **Driver**: go online, see requests within 12 km for their vehicle, accept, navigate, "I've arrived", enter OTP, complete. Earnings, trips, hours online and rating today.
- **Chat** between rider and driver from acceptance until the trip ends; numbers are never shared.
- **OTP on time**: created when the driver arrives, valid 15 minutes, a new code after 3 wrong tries, and the rider can request a fresh one.
- **Ratings** both ways after the trip (stars, tags, comment); averages shown on cards.
- **Safety**: SOS (alerts support, offers to call 112), and a share-trip link anyone can follow live.
- **Extras**: cancellation reasons (₹30 fee once the driver has arrived), saved places, receipts, ride history, card/UPI test checkout.

## Run it

Needs **Node.js 22.18+** (24 recommended).

Terminal 1, the API (port 3000), admin site (3002) and dev sign-in (4000):

```bash
cd Backend
npm install
npm run seed
npm run dev
```

Terminal 2, the web app:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** (exactly this address: it's the registered sign-in redirect). Without Auth0 settings, the sign-in buttons open the **dev sign-in**, where you pick a test account:

| Account | Use it to |
|---|---|
| `rider@example.test` | Book rides (has past rides, Home and Work saved) |
| `driver@example.test` | Drive (approved car driver near Ghatkopar) |
| `newdriver@example.test` / `newrider@example.test` | Go through onboarding from scratch |
| `admin@example.test` | Admin site at http://localhost:3002: approve drivers, see rides, chats, ratings, SOS |

Use one browser tab for the rider and another for the driver. If the browser can't share your location, the driver uses a demo position in Mumbai and the rider sets the pickup by search.

### Keys (`.env` files)

- `Backend/.env`: `OLA_MAPS_API_KEY` (from Krutrim **Maps Credentials**), and `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_APP_CLIENT_ID` (+ admin client) for real Auth0 sign-in. See `Backend/.env.example` and [`Backend/docs/auth0-setup.md`](Backend/docs/auth0-setup.md). In your Auth0 application, add `http://localhost:5173/auth` to **Allowed Callback URLs** and `http://localhost:5173` to **Allowed Web Origins**, and enable the Google connection.
- `frontend/.env`: `VITE_OLA_MAPS_API_KEY` for the map tiles. Without Ola, search, routes and tiles fall back to OpenStreetMap.

## Checks

```bash
cd Backend
npm run check
```

This type-checks, lints and runs the 52 tests with an 80% coverage gate. In `frontend/`, run `npm run lint` and `npm run build`.
