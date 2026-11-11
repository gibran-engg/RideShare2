/**
 * Development-only OpenID Connect provider that behaves like our Auth0 tenant, so everything
 * works offline and in tests:
 *   discovery, /authorize (code flow, PKCE S256 required), /token (authorization_code and
 *   refresh_token), /jwks, /userinfo, /oauth/revoke.
 * ID tokens and access tokens are RS256 JWTs signed with a key generated at startup. Access tokens
 * carry the API audience and the same roles claim the Auth0 Post-Login Action adds. Anyone can sign
 * in as any email, so it refuses to start in production (and isn't used once Auth0 is configured).
 */
import crypto from "node:crypto";
import express from "express";
import type { Response } from "express";
import config from "../lib/config.ts";
import { isMain } from "../lib/is-main.ts";
import type { AppKey } from "../lib/config.ts";

if (config.isProduction || !config.oauth.mock.enabled) {
    console.error("mock-oauth is a development tool and is disabled (NODE_ENV=production or MOCK_OAUTH_ENABLED=false).");
    process.exit(1);
}

const ISSUER = config.urls.mockOAuth;
const AUDIENCE = config.identity.audience;
const ROLES_CLAIM = config.identity.rolesClaim;
const CODE_TTL_MS = 60 * 1000;
const ACCESS_TOKEN_TTL_S = 3600;
// Auth0's default ID token lifetime; the admin session lasts this long.
const ID_TOKEN_TTL_S = 10 * 60 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Client {
    clientId: string;
    /** null for a public client (the phone app): it proves itself with PKCE instead of a secret. */
    clientSecret: string | null;
    appKey: AppKey;
    redirectUris: string[];
}

// Like the Allowed Callback URLs of the two Auth0 applications.
const REDIRECT_URIS: Record<AppKey, string[]> = {
    app: ["rideshare://auth", `${config.urls.web}/auth`],
    admin: [`${config.urls.admin}/auth/mock/callback`]
};

const clients = new Map<string, Client>(
    (Object.entries(config.oauth.mock.clients) as [AppKey, { clientId: string; clientSecret: string | null }][]).map(
        ([appKey, registered]) => [registered.clientId, { ...registered, appKey, redirectUris: REDIRECT_URIS[appKey] }]
    )
);

// The users and roles you'd create in the Auth0 dashboard (User Management -> Users / Roles).
// The rider and driver match `npm run seed`; the "new" ones start onboarding with their role already chosen.
const ROLES_BY_EMAIL: Record<string, string[]> = {
    "admin@example.test": ["admin"],
    "rider@example.test": ["rider"],
    "driver@example.test": ["driver"],
    "newrider@example.test": ["rider"],
    "newdriver@example.test": ["driver"]
};
const SAMPLE_ACCOUNTS: Record<AppKey, { email: string; name: string; note: string }[]> = {
    app: [
        { email: "rider@example.test", name: "Asha Rider", note: "Role: rider (seeded)" },
        { email: "driver@example.test", name: "Ravi Driver", note: "Role: driver (seeded, approved)" },
        { email: "newdriver@example.test", name: "Neha Newdriver", note: "Role: driver - try onboarding" },
        { email: "newrider@example.test", name: "Kabir Newrider", note: "Role: rider - try onboarding" }
    ],
    admin: [
        { email: "admin@example.test", name: "Platform Admin", note: "Role: admin" },
        { email: "rider@example.test", name: "Asha Rider", note: "Role: rider - should be refused" }
    ]
};

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_ID = crypto.randomBytes(8).toString("hex");
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: KEY_ID, alg: "RS256", use: "sig" };

interface Grant {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    nonce?: string;
    audience?: string;
    scope: string;
    email: string;
    name: string;
    expiresAt: number;
}
interface Profile {
    sub: string;
    email: string;
    email_verified: boolean;
    name: string;
}

interface Session {
    clientId: string;
    profile: Profile;
    audience?: string;
    scope: string;
    expiresAt: number;
}

const codes = new Map<string, Grant>();
const accessTokens = new Map<string, { profile: Profile; expiresAt: number }>();
const refreshTokens = new Map<string, Session>();
type Params = Record<string, string | undefined>;

function b64url(input: string): string {
    return Buffer.from(input).toString("base64url");
}

function signJwt(payload: Record<string, unknown>): string {
    const header = { alg: "RS256", typ: "JWT", kid: KEY_ID };
    const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = crypto.sign("sha256", Buffer.from(data), privateKey).toString("base64url");
    return `${data}.${signature}`;
}

function subjectFor(email: string): string {
    return crypto.createHash("sha256").update(`mock:${email}`).digest("hex").slice(0, 24);
}

function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function oauthError(res: Response, status: number, error: string, description: string): void {
    res.status(status).json({ error, error_description: description });
}

/** Validate the authorization request; returns the client or sends an error page. */
function validateAuthorizeRequest(params: Params, res: Response): Client | null {
    const client = clients.get(params.client_id || "");
    if (!client) {
        res.status(400).send("Unknown client_id.");
        return null;
    }
    if (!params.redirect_uri || !client.redirectUris.includes(params.redirect_uri)) {
        // Never redirect to an unregistered URI.
        res.status(400).send("redirect_uri is not registered for this client.");
        return null;
    }
    const problem =
        params.response_type !== "code"
            ? "unsupported_response_type"
            : !String(params.scope || "")
                    .split(" ")
                    .includes("openid")
              ? "invalid_scope"
              : !params.code_challenge || params.code_challenge_method !== "S256"
                ? "invalid_request"
                : params.audience && params.audience !== AUDIENCE
                  ? "access_denied"
                  : null;
    if (problem) {
        const url = new URL(params.redirect_uri);
        url.searchParams.set("error", problem);
        if (params.state) url.searchParams.set("state", params.state);
        res.redirect(url.href);
        return null;
    }
    return client;
}

const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
    // Forms post here and then redirect back to the registered apps (including the phone app's rideshare:// link).
    const appOrigins = [config.urls.admin, config.urls.web].map((url) => new URL(url).origin).join(" ");
    res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${appOrigins} rideshare:; frame-ancestors 'none'`
    );
    res.setHeader("X-Frame-Options", "DENY");
    // The browser version of the app swaps its code for tokens with fetch(), like Auth0's "Allowed Web Origins".
    const origin = req.get("origin");
    if (origin && origin === new URL(config.urls.web).origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
        res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
});

app.get("/.well-known/openid-configuration", (req, res) => {
    res.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        jwks_uri: `${ISSUER}/jwks`,
        revocation_endpoint: `${ISSUER}/oauth/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        scopes_supported: ["openid", "email", "profile", "offline_access"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
        code_challenge_methods_supported: ["S256"],
        claims_supported: ["sub", "email", "email_verified", "name", "iss", "aud", "exp", "iat", "nonce"],
        authorization_response_iss_parameter_supported: true
    });
});

app.get("/jwks", (req, res) => res.json({ keys: [publicJwk] }));

app.get("/authorize", (req, res) => {
    const client = validateAuthorizeRequest(req.query as Params, res);
    if (!client) return;

    const hidden = [
        "client_id",
        "redirect_uri",
        "response_type",
        "scope",
        "state",
        "nonce",
        "code_challenge",
        "code_challenge_method",
        "audience"
    ]
        .map((key) => `<input type="hidden" name="${key}" value="${escapeHtml((req.query as Params)[key])}">`)
        .join("");
    const samples = SAMPLE_ACCOUNTS[client.appKey]
        .map(
            (account) => `
            <form method="post" action="/authorize" class="account">
                ${hidden}
                <input type="hidden" name="email" value="${escapeHtml(account.email)}">
                <input type="hidden" name="name" value="${escapeHtml(account.name)}">
                <button type="submit"><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.email)}</span><em>${escapeHtml(account.note)}</em></button>
            </form>`
        )
        .join("");

    res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dev sign-in</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: "Segoe UI", system-ui, sans-serif; background: #0f1115; color: #eceef2; margin: 0; display: grid; place-items: center; min-height: 100vh; padding: 16px; box-sizing: border-box; }
  main { background: #171a21; border: 1px solid #2a2f3a; border-radius: 16px; padding: 28px; width: 100%; max-width: 440px; }
  h1 { font-size: 1.3rem; margin: 0 0 4px; } p { color: #9aa1ae; margin: 0 0 18px; font-size: .9rem; }
  .warn { background: #36280a; color: #fbbf24; padding: 8px 12px; border-radius: 8px; font-size: .8rem; margin-bottom: 18px; }
  .account { margin: 0 0 10px; }
  .account button { width: 100%; text-align: left; display: grid; gap: 2px; padding: 12px 14px; border-radius: 10px; border: 1px solid #2a2f3a; background: #1e222b; color: inherit; font: inherit; cursor: pointer; }
  .account button:hover { border-color: #facc15; }
  .account span { color: #9aa1ae; font-size: .85rem; } .account em { color: #facc15; font-size: .78rem; font-style: normal; }
  label { display: grid; gap: 6px; font-size: .85rem; margin-bottom: 10px; }
  input[type=email], input[type=text] { padding: 10px; border-radius: 8px; border: 1px solid #2a2f3a; background: #0f1115; color: inherit; font: inherit; }
  .go { width: 100%; padding: 11px; border: 0; border-radius: 10px; background: #facc15; color: #1f1a00; font-weight: 700; font: inherit; cursor: pointer; }
  hr { border: 0; border-top: 1px solid #2a2f3a; margin: 18px 0; }
</style></head>
<body><main>
  <h1>Dev sign-in</h1>
  <p>Signing in to <strong>${escapeHtml(client.appKey === "admin" ? "RideShare Admin" : "RideShare app")}</strong></p>
  <div class="warn">Local stand-in for Auth0. Set AUTH0_* in .env to sign in with your Auth0 tenant.</div>
  ${samples}
  <hr>
  <form method="post" action="/authorize">
    ${hidden}
    <label>Email <input type="email" name="email" required placeholder="you@example.test"></label>
    <label>Name <input type="text" name="name" placeholder="Your name"></label>
    <button class="go" type="submit">Continue</button>
  </form>
</main></body></html>`);
});

app.post("/authorize", (req, res) => {
    const client = validateAuthorizeRequest(req.body, res);
    if (!client) return;

    const email = String(req.body.email || "")
        .trim()
        .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).send("Please go back and enter a valid email.");
    }

    const code = crypto.randomBytes(24).toString("base64url");
    codes.set(code, {
        clientId: client.clientId,
        redirectUri: req.body.redirect_uri,
        codeChallenge: req.body.code_challenge,
        nonce: req.body.nonce || undefined,
        audience: req.body.audience || undefined,
        scope: String(req.body.scope || "openid"),
        email,
        name:
            String(req.body.name || "")
                .trim()
                .slice(0, 80) || email.split("@")[0],
        expiresAt: Date.now() + CODE_TTL_MS
    });

    const url = new URL(req.body.redirect_uri as string);
    url.searchParams.set("code", code);
    url.searchParams.set("iss", ISSUER);
    if (req.body.state) url.searchParams.set("state", req.body.state);
    res.redirect(url.href);
});

function authenticateClient(req: express.Request): Client | null {
    let clientId = req.body.client_id;
    let clientSecret = req.body.client_secret;
    const header = req.get("authorization") || "";
    if (header.startsWith("Basic ")) {
        const decoded = Buffer.from(header.slice(6), "base64").toString();
        const index = decoded.indexOf(":");
        clientId = decodeURIComponent(decoded.slice(0, index));
        clientSecret = decodeURIComponent(decoded.slice(index + 1));
    }
    const client = clients.get(clientId);
    if (!client) return null;
    // A public client must not send a secret; a confidential one must send the right one.
    if (client.clientSecret === null) return clientSecret ? null : client;
    return client.clientSecret === clientSecret ? client : null;
}

/** Access token (JWT for the API), ID token, and a rotating refresh token when offline_access was asked for. */
function issueTokens(client: Client, session: Omit<Session, "expiresAt">, nonce?: string) {
    const now = Math.floor(Date.now() / 1000);
    const { profile } = session;
    const roles = ROLES_BY_EMAIL[profile.email] || [];
    const accessToken = signJwt({
        iss: ISSUER,
        sub: profile.sub,
        // Like Auth0: the API audience plus /userinfo, which the API calls once for a new user.
        aud: session.audience ? [session.audience, `${ISSUER}/userinfo`] : `${ISSUER}/userinfo`,
        azp: client.clientId,
        scope: session.scope,
        iat: now,
        exp: now + ACCESS_TOKEN_TTL_S,
        [ROLES_CLAIM]: roles
    });
    accessTokens.set(accessToken, { profile, expiresAt: Date.now() + ACCESS_TOKEN_TTL_S * 1000 });

    let refreshToken: string | undefined;
    if (session.scope.split(" ").includes("offline_access")) {
        refreshToken = crypto.randomBytes(32).toString("base64url");
        refreshTokens.set(refreshToken, { ...session, expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS });
    }
    return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_S,
        scope: session.scope,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        id_token: signJwt({
            iss: ISSUER,
            aud: client.clientId,
            iat: now,
            exp: now + ID_TOKEN_TTL_S,
            nonce,
            ...profile,
            [ROLES_CLAIM]: roles
        })
    };
}

app.post("/token", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const client = authenticateClient(req);
    if (!client) return oauthError(res, 401, "invalid_client", "Client authentication failed.");

    if (req.body.grant_type === "refresh_token") {
        const session = refreshTokens.get(req.body.refresh_token);
        refreshTokens.delete(req.body.refresh_token); // rotation: each refresh token works once
        if (!session || session.expiresAt < Date.now() || session.clientId !== client.clientId) {
            return oauthError(res, 400, "invalid_grant", "Refresh token is invalid or expired.");
        }
        return res.json(issueTokens(client, session));
    }
    if (req.body.grant_type !== "authorization_code") {
        return oauthError(res, 400, "unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
    }

    const grant = codes.get(req.body.code);
    codes.delete(req.body.code); // single use
    if (!grant || grant.expiresAt < Date.now() || grant.clientId !== client.clientId) {
        return oauthError(res, 400, "invalid_grant", "Code is invalid or expired.");
    }
    if (grant.redirectUri !== req.body.redirect_uri) {
        return oauthError(res, 400, "invalid_grant", "redirect_uri mismatch.");
    }
    const challenge = crypto
        .createHash("sha256")
        .update(String(req.body.code_verifier || ""))
        .digest("base64url");
    if (challenge !== grant.codeChallenge) {
        return oauthError(res, 400, "invalid_grant", "PKCE verification failed.");
    }

    const profile = { sub: subjectFor(grant.email), email: grant.email, email_verified: true, name: grant.name };
    res.json(issueTokens(client, { clientId: client.clientId, profile, audience: grant.audience, scope: grant.scope }, grant.nonce));
});

app.post("/oauth/revoke", (req, res) => {
    const client = authenticateClient(req);
    if (!client) return oauthError(res, 401, "invalid_client", "Client authentication failed.");
    const session = refreshTokens.get(req.body.token);
    if (session && session.clientId === client.clientId) refreshTokens.delete(req.body.token);
    res.sendStatus(200);
});

app.get("/userinfo", (req, res) => {
    const token = (req.get("authorization") || "").replace(/^Bearer /, "");
    const entry = accessTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) return oauthError(res, 401, "invalid_token", "Unknown or expired token.");
    res.json(entry.profile);
});

setInterval(() => {
    const now = Date.now();
    for (const [code, grant] of codes) if (grant.expiresAt < now) codes.delete(code);
    for (const [token, entry] of accessTokens) if (entry.expiresAt < now) accessTokens.delete(token);
    for (const [token, session] of refreshTokens) if (session.expiresAt < now) refreshTokens.delete(token);
}, 60 * 1000).unref();

if (isMain(import.meta.url)) {
    // All interfaces, so the phone can reach the sign-in page over Wi-Fi.
    app.listen(config.ports.mockOAuth, "0.0.0.0", () => {
        console.log(`Mock OAuth provider (dev only) running at ${ISSUER}`);
    });
}

export default app;
