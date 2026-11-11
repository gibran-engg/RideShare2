# Ride-Sharing Platform

A ride-sharing platform inspired by Ola and Uber: an **Android/iOS app** with a dark monochrome map, a **Node.js backend**, and a **Node.js admin website**.

Why things are built the way they are: see **[decision.md](decision.md)**.

| Part | Folder | What it is |
|---|---|---|
| **Android app** | `mobile/` | Expo (React Native) app for **riders and drivers**, built as an APK with the Android SDK: Auth0 sign-in, onboarding, MapLibre map, booking, live trip tracking. Also runs in a desktop browser for development and demos |
| **API** | `backend/` | Node + Express JSON API that accepts **Auth0 JWT access tokens**, WebSocket live updates, OpenStreetMap search/routing |
| **Admin app** | `apps/admin/` | Node + EJS website: verify drivers, monitor rides, manage users, SMS and audit logs |
| Dev sign-in | `mock-oauth/` | Local stand-in for Auth0 (same JWTs and roles) for development and tests; off in production and once Auth0 is configured |
| Business logic | `services/`, `lib/`, `db/` | Database (SQLite), rides, fares, drivers, OTP, JWT checks, OAuth |

## Actors

- Rider
- Driver
- Admin

## External Systems

- **Map**: OpenStreetMap. Dark monochrome tiles from **MapTiler** (`MAPTILER_KEY` in `.env`; without a key the apps fall back to CARTO, which shows an "API KEY REQUIRED" watermark). The apps get the tile URL from `/api/config`. Place search via **Nominatim**, road routes/ETA via **OSRM**, all called through the API.
- **Identity (IAM)**: **Auth0**. Users, passwords and the roles `admin`, `rider`, `driver` live in Auth0; the apps sign in with OAuth 2.0 + PKCE and the API checks the JWTs. Setup: **[docs/auth0-setup.md](docs/auth0-setup.md)**. Dev sign-in stands in for it locally.
- **SMS / Messaging**: console provider (messages are logged and visible in the Admin app).

## Architecture

The system context diagram is in `architecture/`.

```
 Android app ──JWT over HTTP/WS──► backend (API :3000) ──► services/ ──► SQLite (data/rideshare.db)
      │                               │   ├─ verifies JWTs with Auth0's public keys (JWKS)
      │ sign-in: OAuth 2.0 + PKCE     │   ├─ OSM: Nominatim (search), OSRM (routes)
      └──► Auth0 (or Dev sign-in) ◄───┘   └─ SMS (console)
 Browser ──► apps/admin (:3002) ──► services/      (admin signs in with Auth0, needs the admin role)
```

## Run it

You need **Node.js 22.18+** (24 recommended; the backend is TypeScript that Node runs directly) on the PC, and an **Android phone** on the **same Wi-Fi** as the PC.

```bash
npm install
npm run seed      # demo accounts + a few past rides (optional)
npm run dev       # API :3000, Admin :3002, Dev sign-in :4000 (until Auth0 is configured)
```

Sign-in uses **Auth0** once `AUTH0_*` is set in `.env` ([docs/auth0-setup.md](docs/auth0-setup.md)). Until then, **Dev sign-in** shows these accounts:

| Account | Role | Use it to |
|---|---|---|
| `rider@example.test` | rider | Book rides |
| `driver@example.test` | driver | Accept rides (approved car driver) |
| `newrider@example.test` / `newdriver@example.test` | rider / driver | Go through onboarding from scratch |
| `admin@example.test` | admin | Admin app at http://localhost:3002 |

**On the phone**: install the APK ([docs/android-build.md](docs/android-build.md)), open RideShare and tap **Sign in or sign up**. Expo Go can't run this app any more, because the MapLibre map is a native module that Expo Go doesn't include.

In development, SMS codes are printed in the terminal and also shown on the verify screen.

> One phone can only be one user at a time. To play rider and driver together, use a second phone, a browser tab (below), or sign out and switch.

### Run it in the browser (no phone)

For development and demos on the PC:

```bash
cd mobile
npm install
npm run web
```

Open http://localhost:5173 (exactly this address; Auth0 returns there). It's the same app and code as on the phone, shown at phone width. Each tab has its own sign-in, so you can be the rider in one tab and the driver in another. Sign-in opens in a popup, so allow popups for localhost if the browser blocks it.

How it fits together: the web dev server (Expo/Metro) forwards `/api` to the API (`mobile/metro.config.js`), so no CORS is needed for API calls; sign-in talks to Auth0 (or Dev sign-in) directly, and live updates connect to `ws://localhost:3000/ws`. Browser-only code lives in `*.web.js` files (`MonoMap.web.js` draws the map with Leaflet, `token.web.js` keeps the sign-in per tab) or behind `Platform.OS === "web"`; none of it is in the Android build. If the browser has no location, rider and driver both start at the default spot (Ghatkopar) so they still match.

### Troubleshooting

- **"Can't reach the RideShare server"**: the phone must be on the same Wi-Fi, and the APK must have been built with the PC's current IP. Check the API at `http://<PC-IP>:3000/api/health` in the phone's browser. If Windows Firewall asks, allow Node.js on private networks.
- **Blank map**: map tiles load from MapTiler (or `basemaps.cartocdn.com` without a key), so the phone needs internet.
- **C: drive full**: the npm cache is set to `D:\.npm-cache` by `.npmrc`.

## Sign-in: Auth0, OAuth 2.0 + PKCE, JWT

```
App ── Authorization Code + PKCE (expo-auth-session) ──► Auth0 login page
Auth0 ──► rideshare://auth?code=… ──► App ── code + PKCE verifier ──► Auth0 /oauth/token
App ◄── access token (RS256 JWT for the RideShare API) + refresh token (kept in the Android Keystore)
App ── Authorization: Bearer <JWT> ──► API: signature (Auth0 JWKS), iss, aud, exp checked; roles read
```

- The API never sees a password: it only verifies the JWT on each request (`services/auth/jwt.ts`) and finds the local account by the token's `sub` (`services/auth/service.ts`). The first request of a new user reads their email and name from Auth0's `/userinfo` once.
- **Roles** come from the `https://rideshare.app/roles` claim, added by an Auth0 Post-Login Action. `admin` opens the admin website. `rider` / `driver` set the account type, so onboarding skips that choice; users without a role pick one.
- **Sessions**: access tokens expire (24 h in Auth0 by default, 1 h in Dev sign-in), and the app renews them with a rotating refresh token. JWTs can't be revoked, so suspending a user in the admin app takes effect because every request (and the live-updates socket) checks the account's status.
- The **admin website** signs in server-side (Regular Web Application with a client secret). The signed ID token must contain the `admin` role, and the admin session ends when that ID token expires.

Without `AUTH0_*` in `.env`, **Dev sign-in** (`mock-oauth/`) plays Auth0's part with the same flow, JWTs and roles: `admin@example.test` (admin), `rider@example.test` (rider), `driver@example.test` (driver), plus `newrider@` / `newdriver@` for onboarding.

## App flow

**Onboarding**: choose ride or drive → name and phone → SMS code. Drivers also add licence and vehicle details and photograph their licence and RC, then wait for an admin to approve them. The screen updates by itself when they're approved.

**Rider**:
1. The map opens on your location, which is the default pickup.
2. Tap **Where to?** and search a place, or choose it on the map with the centre pin.
3. The route is drawn, with fare and ETA for bike, auto and car.
4. Request the ride, then watch the driver's car approach.
5. Share the 4-digit OTP with the driver.
6. At the end the app shows the fare. Payments are out of scope, so you pay the driver directly.

**Driver**:
1. Go online. Your GPS position is shared while you're online or on a trip.
2. Requests within 12 km for your vehicle type pop up. Accept one.
3. **Navigate** opens your maps app. Tap **I've arrived**.
4. Enter the rider's OTP to start the trip, then complete it. Earnings are shown on the map screen.

Live updates use a WebSocket (`/ws`). The app is told to refresh when its ride changes, the driver moves, a new request arrives, or an admin acts.

## Admin app

Open http://localhost:3002 and sign in with an email from `ADMIN_EMAILS`. From there you can:
- review drivers and their documents, and approve them or request changes (the driver gets an SMS)
- see live and past rides, and cancel a ride
- suspend users (this also signs them out of the app)
- read the SMS and audit logs

## API

All `/api` routes except health and config need `Authorization: Bearer <Auth0 access token>`.

| Method | Path | |
|---|---|---|
| GET | `/api/health`, `/api/config` | Status; Auth0 tenant/client/audience for sign-in, map tiles, vehicles |
| POST | `/api/auth/logout` | Records a sign-out (the app discards and revokes its tokens) |
| GET | `/api/me` | User, driver profile, next onboarding step |
| POST | `/api/onboarding/profile`, `/verify`, `/resend`, `/driver` (multipart) | Onboarding |
| GET | `/api/places/search?q=&lat=&lng=`, `/api/places/reverse?lat=&lng=` | OpenStreetMap search |
| POST | `/api/rides/estimate`, `/api/rides` | Quote; book (fare computed on the server) |
| GET | `/api/rides/active`, `/api/rides`, `/api/rides/:id` | Current ride, history, one ride |
| POST | `/api/rides/:id/cancel` | Rider cancels / driver releases |
| POST | `/api/rides/:id/accept`, `/arrived`, `/start` `{otp}`, `/complete` | Driver trip steps |
| GET/POST | `/api/driver/requests`, `/location`, `/online`, `/earnings` | Driver |
| WS | `/ws` | Send `{type:"auth", token}` with the JWT; receive `{type:"refresh"}`. Closed when the token expires (the app reconnects) |

## Building the Android app

The APK is built locally with the Android SDK and JDK 17 in `D:\Android` (no Expo account needed). The map is drawn with **MapLibre**, so no Google Maps key is needed. Steps, installing on a phone and troubleshooting: **[docs/android-build.md](docs/android-build.md)**.

```bash
cd mobile
bash scripts/build-android.sh http://192.168.1.37:3000
```

## Tests

```bash
npm test
```

There are 38 tests (`npm run check` also type-checks, lints and enforces 80% line coverage). They cover the ride state machine, migrations, payment webhook signatures, idempotent booking, card/UPI checkout, ride and trip history, activity timelines, the admin user page, the OpenAPI document, and PKCE sign-in → JWT → onboarding with document upload → admin approval → booking → OTP → completion, the WebSocket updates, refresh-token rotation, the admin role check, and checks that forged, tampered, unsigned and wrong-audience JWTs, stolen sign-in codes, strangers viewing rides and app-set fares are all rejected. Tests use a temporary database and never call the public OpenStreetMap servers.

Mobile checks: `cd mobile && npx eslint src metro.config.js && npx expo-doctor`. To check that the phone builds still bundle after a change made for the browser: `npx expo export --platform ios --platform android`.

## Project structure

Each feature is split the same way: HTTP in `backend/src/features/<feature>/` (router + schemas), business logic and SQL in `services/<feature>/` (service + repository), so the admin app reuses the same rules. Files import each other directly by path.

```
backend/src/
├── features/
│   ├── auth/       router.ts (logout)
│   ├── users/      router.ts (me, onboarding)  schemas.ts
│   ├── drivers/    router.ts (driver onboarding, online, location, earnings)  schemas.ts  documents.ts (uploads)
│   ├── rides/      router.ts (estimate, book, trip steps, history)  schemas.ts
│   ├── places/     router.ts (search, reverse geocoding)  schemas.ts
│   ├── payments/   router.ts (checkout, webhook, history)  schemas.ts  mock-checkout.ts (test-mode pay page)
│   ├── activity/   router.ts (timeline)  schemas.ts
│   └── system/     router.ts (health, config)
├── core/           route.ts (validation + OpenAPI per route), openapi.ts, auth.ts, idempotency.ts, errors.ts, realtime.ts, schemas.ts
├── app.ts          wiring: /api/v1 (+ /api alias), /docs, sign-in, checkout page
└── main.ts         HTTP server + WebSocket, graceful shutdown

services/
├── auth/        service.ts (tokens, login codes)  repository.ts  oidc.ts (OAuth/OIDC flow)
├── users/       service.ts  repository.ts  otp.ts (phone codes)
├── drivers/     service.ts  repository.ts
├── rides/       service.ts  repository.ts  state.ts (ride state machine)  fare.ts
├── places/      service.ts (OpenStreetMap search and routing)
├── payments/    service.ts  repository.ts  gateway.ts (payment provider interface + test-mode mock)
└── activity/    service.ts (timeline from domain events)  repository.ts
lib/             config, errors, events, types, pagination, idempotency, sms, audit, sessions, CSRF, view helpers
db/              index.ts (connection, transactions, migration runner)  migrations/*.sql
views/, public/  layout partials, error page, styles and browser script for the server-rendered pages

apps/admin/      Admin website (Express + EJS): server.ts, routes.ts, views/
mock-oauth/      Dev-only OpenID Connect provider
mobile/          Expo app (src/app = screens via Expo Router, src/components, src/lib; *.web.js = browser versions)
scripts/         dev.ts (runs API + admin + dev sign-in), seed.ts, reset.ts, migrate.ts
tests/           domain, services, api-v1 and e2e tests + helpers/
architecture/    System context diagram
decision.md      Decision log
```
