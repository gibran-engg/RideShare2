import express from "express";
import { AppError } from "../../../../lib/errors.ts";
import * as paymentGateway from "../../../../services/payments/gateway.ts";
import * as payments from "../../../../services/payments/service.ts";

function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/**
 * The mock provider's hosted checkout page. Only exists in test mode; a real provider hosts this.
 * The session id is an unguessable capability, as with real hosted checkouts.
 */
function mockCheckoutRouter() {
    const router = express.Router();
    const gateway = () => paymentGateway.getGateway() as paymentGateway.MockGateway;

    router.use((req, res, next) => {
        res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"
        );
        res.setHeader("Cache-Control", "no-store");
        next();
    });

    router.get("/pay/mock/:session", (req, res) => {
        const session = gateway().session(String(req.params.session));
        if (!session) throw new AppError("NOT_FOUND", "This checkout has expired. Go back to RideShare and try again.");
        const amount = new Intl.NumberFormat("en-IN", { style: "currency", currency: session.currency }).format(session.amount);
        res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RideShare Pay (test mode)</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b0b; color: #f5f5f5; font-family: system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
  main { width: 100%; max-width: 400px; background: #151515; border: 1px solid #2c2c2c; border-radius: 20px; padding: 28px; }
  .badge { display: inline-block; background: #3a2e00; color: #ffd84d; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; letter-spacing: .5px; }
  h1 { font-size: 20px; margin: 16px 0 4px; } p { color: #8c8c8c; margin: 0 0 20px; font-size: 14px; line-height: 1.4; }
  .amount { font-size: 40px; font-weight: 800; margin: 8px 0 4px; } .method { color: #8c8c8c; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; }
  form { margin: 0; } button { width: 100%; padding: 15px; border-radius: 12px; font: inherit; font-weight: 700; cursor: pointer; margin-top: 10px; }
  .pay { background: #fff; color: #000; border: 0; } .decline { background: transparent; color: #f5f5f5; border: 1px solid #2c2c2c; }
</style></head>
<body><main>
  <span class="badge">TEST MODE</span>
  <h1>RideShare Pay</h1>
  <p>${escapeHtml(session.description)}</p>
  <div class="method">${escapeHtml(session.method)}</div>
  <div class="amount">${escapeHtml(amount)}</div>
  <p>No real money moves. Choose an outcome to see how the app handles it.</p>
  <form method="post"><input type="hidden" name="outcome" value="succeeded"><button class="pay" type="submit">Pay ${escapeHtml(amount)}</button></form>
  <form method="post"><input type="hidden" name="outcome" value="failed"><button class="decline" type="submit">Decline payment</button></form>
</main></body></html>`);
    });

    router.post("/pay/mock/:session", express.urlencoded({ extended: false, limit: "2kb" }), (req, res) => {
        const session = gateway().session(String(req.params.session));
        if (!session) throw new AppError("NOT_FOUND", "This checkout has expired. Go back to RideShare and try again.");
        const outcome = req.body?.outcome === "succeeded" ? "succeeded" : "failed";
        // Exactly what a real provider does: a signed server-to-server webhook, then a browser redirect.
        const { rawBody, signature } = gateway().webhookFor(session.id, outcome);
        payments.handleWebhook(rawBody, signature);
        const back = new URL(session.returnUrl);
        back.searchParams.set("payment", outcome);
        res.redirect(303, back.href);
    });

    return router;
}

export default mockCheckoutRouter();
