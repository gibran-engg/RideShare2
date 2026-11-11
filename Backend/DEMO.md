# Running a RideShare demo

This guide sets up a live demo from scratch and walks through it. Plan **15 minutes** for setup the first time, **5 minutes** before each demo, and **about 12 minutes** for the demo itself.

You'll show four things:
1. **Sign-in and onboarding:** a new driver signs up on the phone and is approved by an admin.
2. **A full ride:** a rider books on the dark map, a driver accepts, the trip starts with an OTP and completes.
3. **The admin console:** every user's rides, trips, payments and activity timeline; payments and refunds; SMS and audit logs.
4. **The API:** interactive documentation of every endpoint.

> **Run every command from the project folder `D:\RideShare`**, not from `mobile\`, unless a step says otherwise. The commands below work in PowerShell (the VS Code terminal) and in bash.

---

## 1. What you need

| Item | Notes |
|---|---|
| A Windows/Mac PC with **Node.js 22.18 or newer** (24 recommended) | Check with `node -v`. The backend is TypeScript that Node runs directly, so older versions won't start it. |
| **One or two phones** (iPhone or Android) with **Expo Go** installed | Free on the App Store / Play Store. Two phones make the ride smoother (rider + driver); one works too, see [Single-phone demo](#single-phone-demo). **No phone?** Run the app in the browser instead, see [3.5](#35-or-run-it-in-the-browser-no-phone-needed). |
| PC and phone(s) on the **same Wi-Fi** | Guest networks and mobile hotspots often block devices from seeing each other. |
| **Internet access** | Map tiles, place search and routes come from online map services. |
| About **1 GB free** on the drive holding the project | The npm cache is set to `D:\.npm-cache`. |

Google/Apple sign-in is **not** needed; the demo uses **Dev sign-in**. See [Optional: Google sign-in](#optional-google-sign-in).

---

## 2. One-time setup

Open a terminal in `D:\RideShare`.

**1. Install the server packages:**

```bash
npm install
```

**2. Install the mobile app packages** (two separate commands; PowerShell 5 doesn't support `&&`):

```bash
cd mobile
```

```bash
npm install
```

Then go back to the project folder:

```bash
cd ..
```

**3. Create your settings file.** Everything has a development default, so this is only needed for Google sign-in or the map key:

```powershell
Copy-Item .env.example .env
```

(bash: `cp .env.example .env`)

**4. Check everything works.** This type-checks, lints and runs the tests; it should end with `pass 35` and `fail 0`:

```bash
npm run check
```

---

## 3. Before every demo (5 minutes)

### 3.1 Start from clean demo data

Stop `npm run dev` if it's running (**Ctrl+C**), then:

```bash
npm run db:reset
```

This deletes the local database and uploaded documents, then loads the demo accounts:

| Account | What it is |
|---|---|
| `rider@example.test` | **Asha Rider**: ready to book, with **4 past rides** (cash paid, card paid, UPI awaiting payment, one cancelled) |
| `driver@example.test` | **Ravi Driver**: approved **car** driver near Ghatkopar, who made those trips |
| `pending.driver@example.test` | **Priya Pending**: driver waiting for approval |
| `newdriver@example.test`, `newrider@example.test` | Fresh accounts for showing onboarding (created on first sign-in) |
| `admin@example.test` | **Platform Admin** for the admin app (from `ADMIN_EMAILS`) |

### 3.2 Start the servers (terminal 1)

```bash
npm run dev
```

Wait for all three lines:

```
[admin] RideShare Admin app running at http://localhost:3002
[oauth] Mock OAuth provider (dev only) running at http://192.168.x.x:4000
[api  ] RideShare API running at http://192.168.x.x:3000 (live updates on /ws, docs at http://192.168.x.x:3000/docs)
```

Write down the `192.168.x.x` address; it's your PC's Wi-Fi IP. **Leave this terminal open**: OTP codes and SMS messages are printed here.

### 3.3 Start the mobile app server (terminal 2)

Open a second terminal, then:

```bash
cd mobile
```

```bash
npm start
```

A QR code appears.

### 3.4 Open the app on the phone(s)

- **iPhone:** open the Camera, point it at the QR code and tap the Expo Go banner.
- **Android:** open Expo Go → **Scan QR code**.
- If scanning fails: in Expo Go choose **Enter URL manually** and type `exp://192.168.x.x:8081`.

The first load takes 30–60 seconds. You should see the **rideshare** welcome screen over a dark map.

**Quick checks:**
- [ ] On the phone's browser, `http://192.168.x.x:3000/api/v1/health` shows `"status":"ok"`
- [ ] On the PC, http://localhost:3002 shows the Admin sign-in page
- [ ] On the PC, http://localhost:3000/docs shows the API documentation
- [ ] The welcome screen shows **Continue with Google**, **Continue with Apple** ("not set up") and **Dev sign-in**
- [ ] Location permission is allowed for Expo Go on the phone(s)

> **Map tiles:** the map uses MapTiler when `MAPTILER_KEY` is set in `D:\RideShare\.env` (free key at https://cloud.maptiler.com). Without it, the map shows an **"API KEY REQUIRED"** watermark instead of streets.

### 3.5 Or: run it in the browser (no phone needed)

Instead of 3.3 and 3.4, start the app for the browser in terminal 2:

```bash
cd mobile
```

```bash
npm run web
```

It opens **http://localhost:5173**, with the app as a phone-sized column in the middle of the window. The same server also shows the QR code, so phones can join at the same time.

- **Each browser tab has its own sign-in.** Use one tab for the rider and a second tab for the driver. A reload keeps you signed in; closing the tab signs you out.
- **Use `localhost:5173` exactly** (not `127.0.0.1` or the Wi-Fi IP): sign-in always returns there.
- **Location:** allow it when the browser asks. If it's blocked or unavailable, rider and driver both start at Ghatkopar, so they still match.
- **Documents:** the licence and RC buttons open a file picker (JPEG or PNG).
- **Navigate** opens OpenStreetMap directions in a new tab. **Call** buttons only work on a phone.

---

## 4. The demo script

### Part A: Driver onboarding (about 3 minutes)

*Shows: OAuth sign-in, phone verification, document upload, admin approval, live updates.*

**On the phone:**
1. Tap **Dev sign-in**. A sign-in page opens inside the app; this is the real OAuth flow, with a local provider standing in for Google.
2. Pick **Neha Newdriver** (`newdriver@example.test`).
3. Choose **I want to drive**, check the name, enter any 10-digit mobile number, tap **Continue**.
4. The verify screen shows the 6-digit code (development only; it's also in terminal 1). Enter it and tap **Verify**.
5. Fill in the licence and vehicle:
   - Licence number: `MH04 20200098765`
   - Vehicle type: **Car** (so the rider's car bookings can reach this driver)
   - Make `Hyundai`, model `Aura`, registration `MH 04 XY 4321`, colour `Grey`
6. Tap **Driving licence** → **Take photo** (any card or piece of paper works), then the same for **Vehicle RC**.
7. Tap **Submit for review**. The screen says *"We're checking your documents"*. **Leave it open.**

**On the PC (Admin app):**
1. Open http://localhost:3002 → **Dev sign-in** → **Platform Admin**.
2. Click **Verification**. Neha is listed next to *Priya Pending*.
3. Click **Review**. Point out the uploaded photos and details.
4. Click **Approve driver** and confirm.

**Back on the phone:** within a few seconds the waiting screen **changes by itself** to the driver map. That's the live update over the WebSocket.

> Optional: on *Priya Pending*, use **Request changes** with a reason to show the rejection path. The SMS appears in terminal 1 and in **SMS log**.

### Part B: A full ride (about 5 minutes)

*Shows: the map, place search, upfront fares, live matching, the OTP check and trip completion.*

Phone 1 = rider, phone 2 = driver. (One phone? See [Single-phone demo](#single-phone-demo).)

**Driver phone:**
1. Use Neha from Part A, or sign out and sign in with **Ravi Driver** (`driver@example.test`).
2. Tap **Go online**. The pill at the top says **Online**, and the driver's GPS position is now shared.

**Rider phone:**
1. Tap **Dev sign-in** → **Asha Rider** (`rider@example.test`).
2. The map centres on your location, and the pickup is filled in automatically.
3. Tap **Search destination** and type a nearby place (for example `Phoenix Marketcity`, or any landmark a few km away). Pick a result.
   - Or tap **Choose on map**, move the map under the pin and tap **Confirm location**.
4. The **white route** is drawn, with prices and ETAs for **Bike, Auto and Car**.
5. Select **Car** and tap **Request Car · ₹…**. The screen shows *Finding a driver*.

**Driver phone:** the request **pops up straight away**, with the fare, distance to pickup and route. Tap **Accept**.

**Rider phone:** the driver's name, vehicle and number plate appear, the **car marker** shows on the map, and a **4-digit OTP** is displayed.

**Driver phone:**
1. Optionally tap **Navigate**, which opens Apple/Google Maps to the pickup. Come back to the app.
2. Tap **I've arrived**. The rider's screen updates to *Driver has arrived*.
3. Ask the rider for the OTP. First type a **wrong code** to show it's refused, then the right one, and tap **Start trip**.
4. Tap **Complete trip**.

**Rider phone:** shows *You've arrived · ₹…*. Tap **Done**, then open **⏱ (history)**: the new ride is at the top, above Asha's 4 earlier rides.

**Driver phone:** today's earnings now include the fare.

> Rides booked on the phone are paid in **cash**, marked paid when the trip completes. Card/UPI checkout is in the API and comes to the apps with the web app; Asha's seeded rides show how those look in the admin console.

### Part C: Admin console (about 3 minutes)

On http://localhost:3002:
1. **Overview:** active rides, drivers online, pending verifications, completed fares and **payments received**.
2. **Users** → click **Asha Rider**. Her page has tabs:
   - **Rides taken:** every ride, including the one you just did, with fare, payment method and status.
   - **Payments:** cash and card paid, UPI *awaiting payment*.
   - **Activity:** her timeline: sign-ins (with IP and device), ride requested, accepted, started, completed, payment received.
3. Go back to **Users** → **Ravi Driver** (or Neha) → **Trips made**: the driver's side of the same rides, with earnings.
4. **Payments:** totals received / awaiting / refunded and every payment. Click a **card** payment's ride → **Refund payment** with a reason. The status changes to *Refunded*, and a *Payment refunded* entry appears on Asha's **Activity** tab.
5. **Rides:** open the ride you just did and show each step with its timestamp.
6. **SMS log:** every message the platform sent.
7. **Users:** **Suspend** Asha and confirm. Her phone app signs out immediately. **Reinstate** her afterwards.
8. **Audit:** the approval, refund and suspension are recorded with who did them.

### Part D: The API (about 1 minute, optional)

Open http://localhost:3000/docs. Every endpoint of `/api/v1` is listed with its inputs, outputs and error codes, generated from the same definitions the server uses to check requests. Good to point out:
- **Errors** always look like `{ "error": { "code": "RIDE_NOT_FOUND", "message": "…" } }`.
- **Booking and checkout** accept an `Idempotency-Key`, so a double tap never books twice.
- **`/me/rides`, `/me/trips`, `/me/payments`, `/me/activity`** are paginated histories.

Try **GET /health** with **Try it out** → **Execute**.

---

## Single-phone demo

With only one phone, switch accounts between steps using **☰ → Sign out**. (Or play the driver in a browser tab on the PC, see [3.5](#35-or-run-it-in-the-browser-no-phone-needed).)

1. Sign in as **Asha Rider**, book a **Car** ride and note the **OTP** on screen. It's also printed in terminal 1 as `Share OTP 1234`.
2. **Sign out** and sign in as **Ravi Driver**. The driver now uses the same phone, so their GPS is right next to the pickup.
3. **Go online**, accept the request, tap **I've arrived**, enter the OTP, then **Start trip** and **Complete trip**.
4. Sign out, sign back in as Asha and open **⏱ history** to show the completed ride.

Keep the admin app's **Rides** page open on the PC while you switch; it acts as a second screen.

---

## Optional: Google sign-in

Google only sends people back to addresses registered on your OAuth client, and allows plain `http://` only for `localhost`. So it works on the **PC** straight away, but the **phone** needs an HTTPS tunnel.

### Google on the PC (admin app, no tunnel)

1. Create the OAuth client as described in the README ([Enable Google sign-in](README.md#enable-google-sign-in)), with these **Authorised redirect URIs**:
   - `http://localhost:3002/auth/google/callback` (admin app)
   - `http://localhost:5173/web/auth/google/callback` (the app in the browser, see [3.5](#35-or-run-it-in-the-browser-no-phone-needed))
2. In `D:\RideShare\.env`, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and add your Gmail to the admin list:
   ```
   ADMIN_EMAILS=admin@example.test,your.name@gmail.com
   ```
3. Restart `npm run dev`. The banner says `Sign-in: google + mock`.
4. Open http://localhost:3002 → **Continue with Google**. The app in the browser (http://localhost:5173) offers it too.

While the Google app is in "Testing" mode, only accounts listed as **test users** on the consent screen can sign in. A brand-new client can take a few minutes to a few hours to start working; until then you'll see `redirect_uri_mismatch`.

### Google on the phone (needs a tunnel)

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   Copy the `https://….trycloudflare.com` URL it prints. It changes every time you restart the tunnel.
2. Add `https://<tunnel>/auth/google/callback` to the OAuth client's redirect URIs.
3. In `D:\RideShare\.env` add `API_URL=https://<tunnel>`, and in `D:\RideShare\mobile\.env` add `EXPO_PUBLIC_API_URL=https://<tunnel>`.
4. Restart both terminals.

Without the tunnel, tapping **Continue with Google** on the phone ends in Google's `redirect_uri_mismatch` page. Use **Dev sign-in** on the phone instead.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **`npm error Missing script`** | You're in `mobile\`. Run `cd ..` and try again from `D:\RideShare`. |
| **`rm` / `-rf` errors in PowerShell** | Don't delete files by hand; use `npm run db:reset`. |
| **`npm run db:reset` says the database is in use** | Stop `npm run dev` with **Ctrl+C** first. |
| App says **"Can't reach the RideShare server"** | Phone and PC must be on the same Wi-Fi. Open `http://192.168.x.x:3000/api/v1/health` on the phone. If it fails, allow **Node.js** through Windows Firewall, or try another network. |
| **QR code won't open** | In Expo Go, use **Enter URL manually**: `exp://192.168.x.x:8081`. As a last resort run `npx expo start --tunnel` in `mobile\`. |
| **"API KEY REQUIRED" across the map** | `MAPTILER_KEY` isn't set in `.env` (see 3.4). Set it and restart `npm run dev`, then reload the app. |
| **Map is black / no streets** | The phone needs internet for map tiles. Zoom in or out once to force a reload. |
| **Place search finds nothing** | Search is biased to Mumbai (set `GEO_VIEWBOX` / `GEO_COUNTRY_CODES` in `.env` for another city). Use **Choose on map** instead. |
| **Driver doesn't see the request** | The driver must be **online**, have the **same vehicle type** the rider chose (Ravi = Car), and be within **12 km** of the pickup. |
| **"Sign-in link expired"** | Login codes last 2 minutes. Tap the sign-in button again. |
| **Google shows `redirect_uri_mismatch`** | On the phone: expected without a tunnel; use Dev sign-in. On the PC: check the redirect URI matches exactly, or wait for a new client to become active. |
| **Stuck after sign-in in Expo Go** | Close the in-app browser and try again; make sure terminal 1 is still running. |
| **Port already in use** | Another copy is still running. Close old terminals, or restart the PC. |
| **Everything looks stale** | Press `r` in terminal 2 to reload the app, or close and reopen Expo Go. |
| **Browser: "Can't reach the RideShare API on port 3000"** | Terminal 1 (`npm run dev`) isn't running. |
| **Browser: sign-in ends with an error page** | Open the app at exactly http://localhost:5173 and sign in again. |

---

## After the demo

- Stop the servers with **Ctrl+C** in both terminals.
- To reset for the next demo, repeat [step 3.1](#31-start-from-clean-demo-data).

## Demo talking points

- **Sign-in:** OAuth 2.0 / OpenID Connect with PKCE, state and nonce. The same flow serves Google, Apple and the dev provider. The app never sees a password.
- **Safety:** drivers are verified by an admin, trips only start with the rider's OTP, and the fare is always calculated on the server.
- **Reliable rides:** every ride follows fixed rules (requested → accepted → arrived → on trip → completed), so two drivers can't take the same ride and a trip can't be completed before it starts.
- **Payments:** cash today; card/UPI go through a payment-provider interface with a test-mode checkout, signed callbacks and refunds, ready for Razorpay or Stripe.
- **Records:** every rider's rides, every driver's trips, every payment and each user's activity are stored and visible to admins.
- **Live:** ride status, the driver's position and new requests are pushed over a WebSocket.
- **Engineering:** TypeScript, a versioned API with generated documentation, database migrations, 35 automated tests and CI on every push.
- **Why each choice was made:** see [decision.md](decision.md).
