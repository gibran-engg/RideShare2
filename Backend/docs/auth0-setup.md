# Auth0 setup: one admin, one rider, one driver

RideShare uses **Auth0** as its identity and access management (IAM) service. Auth0 signs people in
and issues **JWTs**; the API checks those JWTs on every request. Until you finish these steps,
`npm run dev` uses the local **Dev sign-in** (`mock-oauth/`), which behaves the same way.

About 20 minutes, all in the Auth0 dashboard. You need a free account at <https://auth0.com>.

## How it fits together

```
Android app ──(1) Authorization Code + PKCE──► Auth0 login page
            ◄─(2) rideshare://auth?code=…───── Auth0
            ──(3) code + PKCE verifier ──────► Auth0 /oauth/token
            ◄──── access token (JWT), refresh token
            ──(4) Authorization: Bearer <JWT> ──► RideShare API
                                                  checks: RS256 signature (Auth0's public keys, JWKS)
                                                          iss = your tenant, aud = your API, exp
                                                  roles from the "https://rideshare.app/roles" claim
Admin website ── Authorization Code + PKCE (server side, client secret) ──► Auth0
               ID token (JWT) must contain the "admin" role
```

- **Authentication** (who you are) is Auth0's job: passwords, Google login, password resets.
- **Authorization** (what you may do) uses the **roles** in the token: `admin` opens the admin
  website; `rider` / `driver` decide the account type in the app. The API also checks its own rules
  (only an approved driver can go online, only the ride's driver can start it, and so on).
- **PKCE** means an intercepted `?code=` is useless: only the app that started the sign-in has the
  verifier needed to swap it for tokens.

## 1. Create the tenant

Sign up at auth0.com and create a tenant (for example `rideshare-dev`, region closest to you).
Your **domain** is shown at the top left, e.g. `rideshare-dev.us.auth0.com`.

## 2. Register the API

**Applications → APIs → + Create API**

| Field | Value |
|---|---|
| Name | `RideShare API` |
| Identifier | `https://api.rideshare.local` (this is the JWT **audience**; it doesn't have to be a real URL) |
| JSON Web Token (JWT) Signing Algorithm | `RS256` |

Then open the API's **Settings**, turn on **Allow Offline Access** (so the app gets refresh
tokens) and **Save**.

## 3. Register the Android app

**Applications → Applications → + Create Application** → name `RideShare App`, type **Native**.

In its **Settings**:

| Field | Value |
|---|---|
| Allowed Callback URLs | `rideshare://auth, http://localhost:5173/auth` |
| Allowed Web Origins | `http://localhost:5173` |
| Allowed Origins (CORS) | `http://localhost:5173` |
| Refresh Token Rotation | **Allow Refresh Token Rotation** on |

(`http://localhost:5173` is the browser version of the same app, used for demos.) **Save**, then
copy the **Client ID**.

## 4. Register the admin website

**+ Create Application** → name `RideShare Admin`, type **Regular Web Applications**.

| Field | Value |
|---|---|
| Allowed Callback URLs | `http://localhost:3002/auth/auth0/callback` |
| Allowed Logout URLs | `http://localhost:3002/login` |
| Credentials → Authentication Method | **Client Secret (Post)** |

**Save**, then copy the **Client ID** and **Client Secret**. Keep the secret out of git: it only
goes in `.env`.

## 5. Create the roles

**User Management → Roles → + Create Role**, three times: `admin`, `rider`, `driver` (lowercase,
exactly these names). The description can be anything.

## 6. Create the three users

**User Management → Users → + Create User** (connection *Username-Password-Authentication*):

| User | Role to assign (user → **Roles** tab → Assign Roles) |
|---|---|
| e.g. `admin.rideshare@yourmail.com` | `admin` |
| e.g. `rider.rideshare@yourmail.com` | `rider` |
| e.g. `driver.rideshare@yourmail.com` | `driver` |

Use addresses you can receive mail at if you want to verify them; RideShare accepts unverified
emails for **new** accounts, but an unverified email never takes over an existing account.

## 7. Put the roles into the tokens (Post-Login Action)

Auth0 doesn't put roles into tokens by default. **Actions → Library → Create Action → Build from
scratch**: name `Add roles to tokens`, trigger **Login / Post Login**. Replace the code with:

```js
exports.onExecutePostLogin = async (event, api) => {
    // Custom claims must be namespaced with a URL. RideShare reads exactly this name.
    const claim = "https://rideshare.app/roles";
    const roles = event.authorization?.roles || [];
    api.idToken.setCustomClaim(claim, roles);
    api.accessToken.setCustomClaim(claim, roles);
};
```

**Deploy**. Then **Actions → Triggers → post-login**, drag `Add roles to tokens` into the flow
between *Start* and *Complete*, and **Apply**.

## 8. Configure RideShare

In the root `.env` (copy `.env.example` if you don't have one):

```env
AUTH0_DOMAIN=rideshare-dev.us.auth0.com
AUTH0_AUDIENCE=https://api.rideshare.local
AUTH0_APP_CLIENT_ID=<RideShare App client ID>
AUTH0_ADMIN_CLIENT_ID=<RideShare Admin client ID>
AUTH0_ADMIN_CLIENT_SECRET=<RideShare Admin client secret>
```

Restart `npm run dev`. It now prints `Sign-in: Auth0 (https://rideshare-dev.us.auth0.com/)` and
no longer starts the Dev sign-in. The app needs no rebuild: it reads these settings from
`/api/config`.

## 9. Try it

1. **Admin**: open <http://localhost:3002> → *Continue with Auth0* → sign in as the admin user.
   The rider user is refused ("doesn't have the admin role").
2. **Rider**: in the Android app (or `cd mobile && npm run web`), tap *Sign in or sign up* and
   sign in as the rider user. Onboarding skips the "ride or drive" choice because the token says
   `rider`; enter a name and phone number, then the SMS code (printed in the `npm run dev` terminal).
3. **Driver**: sign in as the driver user (second phone, or a second browser tab). Add the licence,
   vehicle and RC photos. In the admin website, approve the driver under *Drivers*.
4. Book a ride as the rider, accept it as the driver.

To look inside a token: copy one from the app's network requests and paste it into
<https://jwt.io>. Only do this with development tokens.

## Optional: "Continue with Google"

**Authentication → Social → Google → Create**. Auth0's development keys work for testing; enable the
connection for both applications. Google users get no role automatically: assign one in
*User Management → Users*, or let them pick rider/driver during onboarding.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Callback URL mismatch` on Auth0's page | The URL in the error must be listed in the application's *Allowed Callback URLs* exactly. |
| App: "Please sign in again" right after signing in | `AUTH0_AUDIENCE` must equal the API identifier exactly; the token's `aud` is checked. |
| Admin: "doesn't have the admin role" | Assign the `admin` role (step 6) **and** add the Action to the post-login trigger (step 7). Sign in again afterwards: roles are read when the token is issued. |
| Signed in, but the account type isn't preset | Same as above for `rider` / `driver`. |
| `Service not found: https://api.rideshare.local` | The API from step 2 is missing or its identifier differs from `AUTH0_AUDIENCE`. |
