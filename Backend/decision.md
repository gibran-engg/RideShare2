# Decision log

Every product and technical decision for RideShare, newest at the bottom of each section.
**Who** shows whether a decision was made by the project owner (you) or proposed by Claude and accepted.

---

## Round 1: first version (web apps)

| # | Decision | Who | Why |
|---|---|---|---|
| 1 | Build two apps: a **User app** (riders + drivers) and an **Admin app** | Owner | Riders and drivers share one sign-in; admin work is separate. |
| 2 | Sign-in with **OAuth 2.0 / OpenID Connect**, Authorization Code flow + PKCE, `state` and `nonce` | Claude | Current best practice for apps signing in through Google/Apple. |
| 3 | **Google** as the first identity provider, plus a local **dev sign-in** provider for testing | Owner | Real accounts in production, no credentials needed to develop. |
| 4 | Delete the uncommitted React/Vite `frontend/` | Owner | Replaced by the new apps. |
| 5 | **SQLite** via Node's built-in `node:sqlite` | Claude | No database server or native build to install. |
| 6 | Mock Map API, SMS and payment services behind small interfaces | Claude | Lets the whole flow run locally; real providers can be swapped in. |
| 7 | Admin access is an email **allowlist** (`ADMIN_EMAILS`), re-checked on every request | Claude | Simple, and removing an email revokes access immediately. |

## Round 2: simplify, Android, real map (current)

The owner found round 1 over-complicated and asked for a monochrome map interface, Google/Apple sign-in, a real map API and an Android app.

| # | Decision | Who | Why |
|---|---|---|---|
| 8 | **One mobile app for riders and drivers**, built with **React Native / Expo** (JavaScript) | Owner | A real Android app in the same language as the Node backend. |
| 9 | Remove the server-rendered rider/driver web pages (`apps/user`) | Claude | The mobile app replaces them; less code to maintain. |
| 10 | Backend becomes a **JSON API** with bearer tokens and **WebSocket** live updates | Claude | What a mobile app needs; replaces cookies, CSRF and page reloads. |
| 11 | **OpenStreetMap** for the map, search and routing | Owner | Free, no API key. |
| 12 | **Dark monochrome** map style (CARTO "Dark Matter" tiles, white route and markers) | Owner | Requested look. |
| 13 | Place search via **Nominatim**, routes/distance/ETA via **OSRM**, both called **through the backend** | Claude | Keeps the free services' usage policy (one User-Agent, caching) in one place and makes them swappable. Falls back to a straight-line estimate if OSRM is down. |
| 14 | Map drawn with `react-native-maps` + OSM tile overlay (not MapLibre) | Claude | Runs inside **Expo Go** with nothing to install on the PC. MapLibre needs a native build (Android SDK). Trade-off: a standalone Android build of `react-native-maps` still needs a (free-tier) Google Maps SDK key; switching to MapLibre later removes that. |
| 15 | **Payments removed**; a trip ends by showing the fare | Owner | Scope cut. |
| 16 | **Keep** the Admin web app, driver document checks and phone OTP | Owner | Not chosen for removal. |
| 17 | Sign-in on mobile uses the **browser OAuth flow through the backend**, which then hands the app a one-time code swapped for an app token | Claude | Works in Expo Go, and is the only way Sign in with Apple works on Android, so Google and Apple share one flow. |
| 18 | **Google now, Apple wired up but switched off** until Apple Developer credentials exist | Owner | No Apple Developer account yet ($99/yr). |
| 19 | Google sign-in on a phone needs the backend on a **public HTTPS URL** (cloudflared/ngrok tunnel) | Claude (constraint) | Google and Apple refuse redirects to private LAN addresses. Dev sign-in works without a tunnel. |
| 20 | Test on the owner's **iPhone with Expo Go**; Android build later (Android Studio on D: or Expo cloud build) | Owner | Only an iOS device is available; Expo builds the same code for both. |
| 21 | Keep all installs/caches on **D:** (`.npmrc` sets the npm cache to `D:\.npm-cache`) | Owner (constraint) | C: drive is nearly full. |
| 22 | Dev servers bind to the PC's **Wi-Fi IP** (auto-detected, override with `DEV_HOST`) | Claude | The phone must reach the API and dev sign-in over the local network. |
| 23 | App tokens are random 256-bit values stored only as SHA-256 hashes, 30-day expiry, revoked on logout | Claude | Revocable and safe if the database leaks; simpler than JWTs. |
| 24 | Driver location comes from the **phone's GPS** (no fixed list of places) | Claude | Needed for a real map; matching still uses a 12 km radius. |
| 25 | Riders pick pickup/drop by **search or by dragging a pin** on the map | Claude | Standard ride-hailing interaction. |
| 26 | The `.env` file stays out of git, and the dev database can be reset (`data/`) | Claude | Payment columns were removed, so the old dev database is recreated. |
| 27 | ETAs from OSRM are multiplied by a **city traffic factor (1.8, `GEO_TRAFFIC_FACTOR`)** | Claude | OSRM assumes empty roads (it said 6 min for 5.4 km in Mumbai), which made ETAs and time-based fares unrealistically low. |
| 28 | The fare is always **computed on the server** when a ride is booked; any price sent by the app is ignored | Claude | Stops a modified app from choosing its own fare. |
| 29 | The rider sees the trip **OTP**; the driver never receives it from the API | Claude | The OTP proves the right rider got in the car. |
| 30 | Live updates: the app authenticates over the **WebSocket with its first message** (not a URL parameter), then gets `refresh` signals and re-fetches | Claude | Keeps tokens out of URLs/logs; one simple message type for the app to handle. |
| 31 | Mobile sign-in only redirects back to **allow-listed deep links** (`rideshare://`, and `exp://` in development) | Claude | Stops the sign-in flow from being used to send codes to another site. |
| 32 | Admin app's payment screens removed; dashboard shows **fares of completed rides** instead of revenue | Claude | Follows decision 15. |
| 33 | Screens use **Expo Router** (`mobile/src/app`), written in **JavaScript** | Claude | Expo's own guidance for SDK 58; JavaScript matches the backend and keeps the project simple. |
| 34 | Mobile lint uses `eslint-config-expo` with TypeScript **6** pinned as a dev dependency | Claude (constraint) | The lint plugin doesn't support TypeScript 7 yet; installed with `--legacy-peer-deps` because of an unrelated web-only peer conflict. |
| 35 | Removed the Expo template's `LICENSE` file | Claude | It named Expo as copyright holder of your app; choose your own license if you publish. |
| 36 | Document photos are requested as **JPEG on iOS** (not HEIC) | Claude | Admins review documents in a web browser, which can't show HEIC. |
| 37 | Drivers' **"Navigate"** opens the phone's own maps app (Apple Maps / Google Maps), falling back to OpenStreetMap directions | Claude | Turn-by-turn navigation is out of scope for the app itself. |
| 38 | The welcome screen always shows **Google and Apple**; providers not configured on the server appear disabled ("not set up") | Claude | Matches the requested sign-in options while Apple credentials are pending. |
| 39 | Added **DEMO.md**: setup, a scripted 10-minute demo (driver onboarding → admin approval → ride with OTP → admin console), single-phone variant, optional Google sign-in, troubleshooting | Owner | Requested a step-by-step demo guide. |
| 40 | Pin **`react-dom` to 19.3.0** in `mobile/` (installed with `npx expo install react-dom`) | Claude | npm had auto-installed react-dom 19.3.1 (needed by Expo Router's web support), which requires react 19.3.1 while Expo SDK 58 pins react 19.3.0. That peer conflict broke `npm audit fix` and plain installs; matching versions fixes it, so `--legacy-peer-deps` is no longer needed. |
| 41 | **Don't run `npm audit fix --force`** in `mobile/`; keep the remaining audit warnings for now | Claude | All 27 warnings come from 3 advisories (braces, node-forge, uuid) deep inside Expo/Metro build tooling. The only "fix" npm offers downgrades Expo to SDK 44, which would break the app. Updates come from Expo patch releases: run `npx expo install --fix` periodically. |

## Round 3: well-engineered backend (TypeScript), then the web app

The owner asked for a backend "robust and well engineered like the big companies", without over-complicating it, plus working OAuth, a placeholder payment gateway, stored user activity, and rider/driver histories visible in the admin app.

| # | Decision | Who | Why |
|---|---|---|---|
| 42 | Keep **SQLite**; no Postgres/Redis/Docker | Owner | Don't over-complicate. Repositories keep all SQL in one layer, so a move to Postgres later touches only `shared/src/repos`. |
| 43 | Backend, shared core, admin app, dev OAuth, scripts and tests are **TypeScript** (strict) | Owner | Typed services and schemas catch mistakes before they run. |
| 44 | Node runs the `.ts` files directly (type stripping); `tsc` only type-checks. No build step, no `tsx` | Claude | Node 22.18+/24 supports it; one less tool and no `dist/` to keep in sync. Requires "erasable" TypeScript (no enums/namespaces/parameter properties). Engines raised to Node 22.18. |
| 45 | **TypeScript 6.0** pinned for the backend too | Claude (constraint) | typescript-eslint doesn't support TypeScript 7 yet (same as decision 34). |
| 46 | Code is **ES modules** (`"type": "module"`) | Claude | Needed for native TypeScript; the modern Node default. |
| 47 | Layers: **routes → services → repositories**. Route handlers are thin (validate, call a service, serialize), so there is no separate controller file per module | Claude | The plan listed controllers; with handlers this small they would only add files. |
| 48 | The **ride lifecycle is a state machine** (`shared/src/domain/ride-state.ts`); every status change goes through it, with an optimistic lock on `rides.version` | Claude | Illegal moves (completing an unstarted trip, a rider "accepting") are impossible from any endpoint, and two drivers can't both accept. |
| 49 | **Versioned API at `/api/v1`**; `/api` stays as an alias with the old `{ error: "message" }` format | Claude | The phone app keeps working unchanged while new clients get the stable contract. |
| 50 | One error format for v1: `{ error: { code, message, details? } }`, with codes in one catalogue that also fixes their HTTP status | Claude | Clients branch on codes, not on English messages. |
| 51 | **zod validation on every endpoint**, and the **OpenAPI 3.1** document (`/api/v1/openapi.json`, Swagger UI at `/docs` in development) is generated from the same schemas | Claude | Docs can't drift from the code. |
| 52 | **Idempotency-Key** on booking and checkout, stored 24 h per user | Claude | A double tap or network retry never books twice; same convention as Stripe/Razorpay. |
| 53 | **Cursor pagination** (`?cursor=&limit=`) on histories and admin lists | Claude | Stable pages while new rides keep arriving. |
| 54 | **Versioned SQL migrations** (`shared/src/db/migrations`, tracked in `PRAGMA user_version`), applied on start and by `npm run db:migrate` | Claude | Schema changes are reviewed files, and old dev databases upgrade in place. |
| 55 | Services emit **domain events** after committing; the **activity log** and **live updates** subscribe to them | Claude | Services don't need to know who listens. Live updates are now pushed immediately instead of polling every 2 s; a 10 s check remains for changes made by the admin app (another process). |
| 56 | **Payments return as a placeholder** (reverses decision 15): rider picks cash/card/UPI when booking; cash is marked paid at trip end; card/UPI go through a `PaymentGateway` interface with a **test-mode mock** (hosted page, HMAC-signed webhook, idempotent handling, admin refunds) | Owner + Claude | Real providers (Razorpay, Stripe) become one class each. |
| 57 | **Activity timeline per user** (`activity_events`, with IP and user agent) for sign-ins, onboarding, every ride step, payments and admin decisions | Owner | Shown on the new admin user page. `audit_log` stays for admin actions. |
| 58 | Admin app gets a **user page** (rides taken, trips made, payments, activity) and a **Payments** page | Owner | Requested visibility of all rides and trips. |
| 59 | **Web sign-in** at `/web/auth/:provider`, always returning to the fixed `<WEB_URL>/signed-in`; the web app's dev server proxies `/web` to the API | Claude | Google accepts `http://localhost` redirect URIs, so Google sign-in works on the web app without a tunnel, and there's no redirect parameter to abuse. |
| 60 | **MapTiler** for map tiles (`MAPTILER_KEY`), CARTO as fallback | Owner | CARTO's free tiles now show an "API KEY REQUIRED" watermark. |
| 61 | Quality gates: `npm run check` (type-check, ESLint, 80% line coverage), Prettier, and **GitHub Actions** on Node 22 and 24 | Owner | Requested. |
| 62 | **Feature folders**: each feature has `router.ts` + `schemas.ts` in `backend/src/features/<x>/` and `service.ts` + `repository.ts` in `shared/src/features/<x>/`; cross-cutting code in `core/`, database in `db/` | Owner | Code for one feature sits together. `shared/` stays a separate package because the admin app reuses the services. |
| 63 | **SQL only in repositories** (plus small infrastructure logs in `shared/src/core`: SMS, audit, idempotency, sessions) | Claude | Token and OTP queries moved out of their services; services decide transactions. |
| 64 | Removed dead code: `verifyCsrf` (and the CSRF exemption for multipart forms, which no admin form uses), `stopRecording`, `isAppError`, `nextStatuses`, unused re-exports, the duplicate `rasterTileUrl` config field, the empty `frontend/`, mobile `package*.json.backup` files and the finished plan document | Owner | Behaviour unchanged; the CSRF exemption removal makes every admin form post require a token. |
| 65 | Kept: workspaces (one `package.json` per app), one `tests/` folder, the `architecture/` diagram, `mobile/AGENTS.md`, the legacy `/api` alias | Owner | |

## Round 4: run the app in a desktop browser

The owner wanted to develop and demo RideShare on the PC, in a browser, without Expo Go, while Android and iOS stay the real target.

| # | Decision | Who | Why |
|---|---|---|---|
| 66 | Turn on **Expo's web support** in the existing `mobile/` app (`react-native-web`); no separate web app and no rewrite | Owner | Same screens and code on phone and browser. Rejected: a separate Vite/React app (every screen twice), an Android emulator (10–20 GB, slow, not in the browser), iOS Simulator (Mac only). |
| 67 | The browser map uses **Leaflet** (plain, without react-leaflet) in `MonoMap.web.js`, with the same props and ref methods the screens use from `react-native-maps`; the phone map is unchanged | Owner + Claude | `react-native-maps` has no web version. Only two new packages in total (`react-native-web`, `leaflet`), and Leaflet shows the same raster tiles as the phone. Moving to MapLibre later (decision 14) only touches the two map files. |
| 68 | Browser-only code lives in **`*.web.js` files** (`MonoMap.web.js`, `token.web.js`) or behind `Platform.OS === "web"` | Claude | Phone code paths stay as they were. Checked with `npx expo export --platform ios --platform android`: the phone bundles contain no Leaflet. |
| 69 | The browser uses the backend's **existing web sign-in** (`/web/auth/:provider` → `/signed-in`, decision 59). The web dev server (Expo/Metro on **:5173**, the `WEB_URL` default) forwards `/api` and `/web` to the API in `mobile/metro.config.js`; the WebSocket connects to `:3000` directly | Claude | No backend changes and no CORS. Google sign-in works in the browser without a tunnel. |
| 70 | In the browser the sign-in token is kept in **sessionStorage**: one sign-in per tab | Claude | Rider and driver side by side in one browser. Fine for development and demos; a public web app should use an HttpOnly cookie instead. |
| 71 | Confirmation dialogs go through `confirmAction` (`src/lib/dialog.js`): the native Alert on phones, the browser's confirm dialog on web | Claude | `react-native-web`'s `Alert` does nothing, which silently broke Cancel ride, Release ride and the document picker. On web, the document buttons open the file picker directly. |
| 72 | In the browser, when location is unavailable, the **driver uses the same fallback spot as the rider** (Ghatkopar) | Claude | Desktop browsers often have no location; without this the driver could never go online, and the demo would stop. Phones still require location. |
| 73 | On a desktop screen the app is shown as a **phone-width (430 px) column** in the middle of the window | Claude | It's a phone app; full-width bottom sheets on a wide screen look broken. |
| 74 | Note: the app is on **Expo SDK 57 / React 19.2.3**, not SDK 58 / React 19.3.0 as decisions 33 and 40 say | Claude | Correction; versions were not changed in this round. |
| 75 | The phone and browser maps take their **tile URL and credit line from `/api/config`**, so they use MapTiler (decision 60) when `MAPTILER_KEY` is set and CARTO otherwise; no tile URL is hard-coded in the app | Owner | The app still had CARTO hard-coded, so the map showed only the watermark. The key stays in the root `.env`; the map shows no tiles until the config has loaded, instead of flashing the watermark. |

## Round 5: a web app without Expo (in progress)

The owner dropped Expo Go: RideShare becomes a web application in the desktop browser, responsive enough for phone browsers later. Native iOS/Android apps are no longer a requirement.

| # | Decision | Who | Why |
|---|---|---|---|
| 76 | **Web-first**: Expo and the `mobile/` app leave the workflow. The last Expo version is tagged **`expo-version`** on GitHub | Owner | Simpler to develop and demo on the PC. |
| 77 | Rider and driver pages are **server-rendered with Express + EJS**: plain HTML forms, CSS, and a little **vanilla JavaScript** for the map, place search and GPS. No React, Vite or other frontend framework; **Leaflet** stays as the one browser library | Owner | Fewest technologies, no build step, the same style as the admin app, and the server already decides fares, ride states and matching. Considered: React + Vite (an easier port of the Expo screens, but a build tool and a second way of rendering pages). |
| 78 | **Compact folder layout**: `server.ts`, `routes/`, `services/` (business logic + SQL), `lib/` (config, sessions, CSRF, errors), `db/`, `views/`, `public/`, `scripts/`, `tests/`, with one `package.json` | Owner + Claude | Adapted from a ChatGPT draft. Server code stays TypeScript (Node runs it directly); browser code is plain JavaScript. |
| 79 | `shared/` moved into `services/`, `lib/`, `db/`, `views/` and `public/`. Files import each other **directly by path** instead of through the `@rideshare/shared` package, and npm workspaces are gone | Claude | Every import shows the file it comes from. Removing the workspaces also dropped a stale `nodemon` install from the lock file; no package versions changed. |
| 80 | Live updates for the web pages will use **Server-Sent Events** (`/events`) instead of the WebSocket | Owner | An ordinary HTTP request that carries the session cookie and reconnects by itself, with no extra package. The browser side already exists in `public/app.js`. |
| 81 | The admin app will move into the same server at **`/admin`** | Owner | One server, one port. |

## Round 6: Auth0, JWT and a native Android app

The owner's requirement list asks for an IAM service with one admin, one passenger and one driver, JWTs, OpenStreetMap, and a hybrid Android app. This round **supersedes 76–77**: the Expo app in `mobile/` stays, as the Android app (and its browser version for demos).

| # | Decision | Who | Why |
|---|---|---|---|
| 82 | **Auth0** is the IAM service. Users, passwords and the roles `admin`, `rider`, `driver` are managed in the Auth0 tenant (setup in `docs/auth0-setup.md`) | Owner | On the requirement list. Considered: Keycloak (self-hosted, more to run) and Microsoft Entra (heavier for a student project). |
| 83 | The apps sign in **directly with Auth0** (Authorization Code + PKCE via `expo-auth-session`), and the API is only a **resource server**: it verifies RS256 **JWT access tokens** (signature against Auth0's JWKS, `iss`, `aud`, `exp`) with `jose`. **Replaces 23** | Claude | The standard Auth0 design for a native app + API. PKCE fixes review issue #2: an intercepted code is useless without the app's verifier. `jose` was already installed as a dependency of `openid-client`, so no new library. |
| 84 | Roles reach the API in a namespaced custom claim, **`https://rideshare.app/roles`**, added by an Auth0 Post-Login Action. `admin` is required for the admin website (replaces the `ADMIN_EMAILS` list). An Auth0 `rider`/`driver` role sets the account type; users without one still choose in onboarding | Claude | Roles managed in one place. Self sign-ups (e.g. with Google) still work without an admin assigning a role first. |
| 85 | Direct Google/Apple sign-in, the API's own bearer tokens and the one-time login codes are **removed** (migration `003` drops their tables). Google can come back as an Auth0 social connection | Owner | One sign-in path to secure and explain. |
| 86 | JWTs can't be revoked, so **suspension is enforced by checking the account status** on every API request and live-update check. The admin website's session ends when its ID token expires; the live-update socket closes when its access token expires | Claude | Keeps the "suspend signs them out everywhere" behaviour without a token blocklist. |
| 87 | **Dev sign-in (`mock-oauth/`) imitates Auth0**: public PKCE client, JWT access tokens with the audience and roles claim, rotating refresh tokens, `/oauth/revoke`. It runs only while `AUTH0_*` is unset, never in production | Claude | Tests and offline development exercise the same code path as Auth0, and the API trusts exactly one issuer at a time. |
| 88 | The Android map uses **MapLibre** (`@maplibre/maplibre-react-native`) instead of `react-native-maps`. **Replaces 14** | Owner | `react-native-maps` needs a Google Maps API key in a real APK; MapLibre is open source and built for OpenStreetMap. Expo Go can no longer run the app. |
| 89 | The APK is built **locally with the Android SDK** (JDK 17, SDK 36, NDK 27 in `D:\Android`; `mobile/scripts/build-android.sh`), release build for `arm64-v8a`, signed with the debug key | Owner | No Expo account needed and rebuilds work offline. C: is nearly full, so everything (including Gradle's cache) is on D:. A Play Store release would need its own signing key. |
| 90 | The development APK allows plain **HTTP** to the PC (`usesCleartextTraffic`), and the API address is built in (`EXPO_PUBLIC_API_URL`) | Claude | The phone reaches the API and Dev sign-in over Wi-Fi without a tunnel. Auth0 itself is always HTTPS. Production would use an HTTPS API and drop this flag. |

## Round 7: merged into uber-video-run (React web app, Ola Maps, ride features)

The owner merged RideShare into the uber-video-run project: RideShare's backend and Auth0 sign-in, uber-video-run's React web app. This round **supersedes 76-77 and the Expo app for this project**: there is no `mobile/` here.

| # | Decision | Who | Why |
|---|---|---|---|
| 91 | RideShare's server (`backend/`, `services/`, `lib/`, `db/`, admin app, dev sign-in, tests) lives in `uber-video-run/Backend`; the old MongoDB/Express backend is replaced (kept in git history) | Owner | One stronger backend; SQLite instead of MongoDB means no database server or Docker |
| 92 | The client is a **React + Vite web app** (`frontend/`), phone-width, signing in with **Auth0 Authorization Code + PKCE** straight from the browser; tokens in sessionStorage (one sign-in per tab) | Owner | What the owner was already testing in the browser. Same Auth0 design as the Android app (decision 83) |
| 93 | Vite proxies `/api`, `/ws` and `/pay` to the API | Claude | No CORS for the API; the WebSocket and the test checkout page work through the same origin |
| 94 | **Ola Maps first** for search, reverse geocoding, routes (traffic-aware) and map tiles; **OpenStreetMap** (Nominatim, OSRM, OSM tiles) when Ola has no key or fails | Owner | Better Indian addresses; never down to nothing |
| 95 | **Three pricing segments** in India time, fixed at booking: normal ×1, peak 08:00-11:00 and 17:00-20:00 ×1.5, late night 00:00-05:00 ×1.3. The multiplier applies to the whole fare, minimum included | Owner (times, multipliers), Claude (minimum) | Configurable in `services/rides/fare.ts`; matches how Uber and Ola apply surge |
| 96 | The fare breakdown (base, distance, time, multiplier) is stored on the ride for receipts | Claude | A receipt must show what was charged even if the rate card changes later |
| 97 | The **trip OTP is created when the driver taps "I've arrived"**, expires after **15 minutes**, and is replaced after **3 wrong tries**; the rider can ask for a new code. A trip can no longer start straight from "accepted" | Owner (timing, expiry), Claude (retries) | The code can't be shared or guessed before the driver is actually there |
| 98 | **Rider-driver chat** per ride, from acceptance until the trip ends; read-only afterwards and visible to admins; quick replies; delivered through the existing live-update refresh | Owner | Contact without sharing phone numbers |
| 99 | **Two-way ratings** after a completed trip (1-5 stars, tags, comment), once per person per ride; averages shown on driver/rider cards and in the admin app | Owner | |
| 100 | Driver onboarding adds **licence expiry, vehicle year, insurance certificate and insurance expiry**; expired documents are refused. No Aadhaar or other government ID numbers are stored | Owner (fields), Claude (no ID numbers) | Enough to verify a driver without holding very sensitive data |
| 101 | Extras: cancellation reasons and a **₹30 fee** (to the driver) when a rider cancels after the driver arrived; **SOS** (alerts support, logged, shown on the admin ride page, offers 112); **share-trip link** (public, no phones or OTP); **saved places**; **receipts**; ride history with ratings; **nearby cabs** for riders (rounded positions, no names); **hours online** for drivers | Owner (approved list) | |
