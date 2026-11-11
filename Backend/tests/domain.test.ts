import "./helpers/env.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AppError, ERROR_STATUS } from "../lib/errors.ts";
import * as activity from "../services/activity/service.ts";
import * as db from "../db/index.ts";
import * as paymentGateway from "../services/payments/gateway.ts";
import * as rideState from "../services/rides/state.ts";
import type { RideStatus } from "../lib/types.ts";
import { toPage, pageLimit } from "../lib/pagination.ts";

const STATUSES: RideStatus[] = ["requested", "accepted", "arrived", "in_progress", "completed", "cancelled"];
const ACTORS = ["rider", "driver", "admin"] as const;

test("ride state machine: exactly the documented transitions are legal", () => {
    const legal = new Set([
        "requested>accepted:driver",
        "requested>cancelled:rider",
        "requested>cancelled:admin",
        "accepted>arrived:driver",
        "accepted>in_progress:driver",
        "accepted>requested:driver",
        "accepted>cancelled:rider",
        "accepted>cancelled:admin",
        "arrived>in_progress:driver",
        "arrived>requested:driver",
        "arrived>cancelled:rider",
        "arrived>cancelled:admin",
        "in_progress>completed:driver",
        "in_progress>cancelled:admin"
    ]);
    for (const from of STATUSES) {
        for (const to of STATUSES) {
            for (const actor of ACTORS) {
                const key = `${from}>${to}:${actor}`;
                assert.equal(rideState.canTransition(from, to, actor), legal.has(key), key);
                if (legal.has(key)) assert.doesNotThrow(() => rideState.assertTransition(from, to, actor));
                else
                    assert.throws(
                        () => rideState.assertTransition(from, to, actor),
                        (err: unknown) => err instanceof AppError && err.code === "RIDE_STATE_CONFLICT"
                    );
            }
        }
    }
});

test("ride state machine: finished rides are terminal and riders can't cancel a started trip", () => {
    for (const to of STATUSES) {
        for (const actor of ACTORS) {
            assert.ok(!rideState.canTransition("completed", to, actor));
            assert.ok(!rideState.canTransition("cancelled", to, actor));
        }
        assert.ok(!rideState.canTransition("in_progress", to, "rider"));
    }
    assert.ok(rideState.isActive("arrived"));
    assert.ok(!rideState.isActive("completed"));
});

test("every error code maps to an HTTP status", () => {
    for (const [code, status] of Object.entries(ERROR_STATUS)) {
        const err = new AppError(code as keyof typeof ERROR_STATUS, "x");
        assert.equal(err.status, status);
        assert.ok(status >= 400 && status < 600);
    }
});

test("migrations build the full schema on an empty database and are idempotent", () => {
    const conn = new DatabaseSync(":memory:");
    const applied = db.migrate(conn);
    const files = db.migrationFiles();
    assert.deepEqual(
        applied,
        files.map((file) => file.version)
    );
    assert.equal(db.schemaVersion(conn), files.at(-1)!.version);
    assert.deepEqual(db.migrate(conn), [], "second run applies nothing");

    const tables = (conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name);
    for (const table of ["users", "rides", "payments", "activity_events", "idempotency_keys"]) assert.ok(tables.includes(table), table);
    const rideColumns = (conn.prepare("PRAGMA table_info(rides)").all() as { name: string }[]).map((row) => row.name);
    assert.ok(rideColumns.includes("payment_method") && rideColumns.includes("payment_status"));
    conn.close();
});

test("migrations upgrade a database created before migrations existed", () => {
    const conn = new DatabaseSync(":memory:");
    // A round-2 database: the original schema, user_version 0.
    conn.exec(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT, picture TEXT, role TEXT, phone TEXT, phone_verified INTEGER NOT NULL DEFAULT 0, onboarding_complete INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), last_login_at TEXT)"
    );
    conn.exec("INSERT INTO users (email) VALUES ('old@example.test')");
    db.migrate(conn);
    assert.equal((conn.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1, "existing rows kept");
    assert.equal(db.schemaVersion(conn), db.migrationFiles().at(-1)!.version);
    conn.close();
});

test("payment webhooks: only correctly signed bodies are accepted", () => {
    const gateway = new paymentGateway.MockGateway();
    const session = gateway.createCheckout({
        paymentId: 1,
        amount: 100,
        currency: "INR",
        method: "card",
        description: "test",
        returnUrl: "http://127.0.0.1:4600/trips/1",
        baseUrl: "http://127.0.0.1:4600"
    });
    assert.match(session.url, /\/pay\/mock\/mock_cs_[0-9a-f]{24}$/);
    assert.ok(gateway.session(session.id));

    const { rawBody, signature } = gateway.webhookFor(session.id, "succeeded");
    assert.deepEqual(gateway.verifyWebhook(rawBody, signature), { sessionId: session.id, outcome: "succeeded" });
    assert.equal(gateway.session(session.id), null, "a session is used once");

    assert.equal(gateway.verifyWebhook(rawBody, undefined), null);
    assert.equal(
        gateway.verifyWebhook(
            rawBody,
            signature.replace(/.$/, (c) => (c === "0" ? "1" : "0"))
        ),
        null
    );
    const forged = JSON.stringify({ sessionId: session.id, outcome: "failed" });
    assert.equal(gateway.verifyWebhook(forged, signature), null, "signature is bound to the body");
    assert.equal(gateway.verifyWebhook("not json", paymentGateway.sign("not json")), null);
});

test("activity: ride events land on both participants' timelines", () => {
    const entries = activity.entriesFor("ride.accepted", { rideId: 7, riderId: 1, driverId: 2, actorId: 2 });
    assert.deepEqual(
        entries.map((e) => [e.userId, e.type, e.entityId, e.metadata?.by]),
        [
            [1, "ride.accepted", 7, "driver"],
            [2, "ride.accepted", 7, "self"]
        ]
    );
    const requested = activity.entriesFor("ride.requested", {
        rideId: 8,
        riderId: 1,
        driverId: null,
        actorId: 1,
        fare: 120,
        paymentMethod: "upi"
    });
    assert.equal(requested.length, 1, "no driver yet");
    assert.equal(activity.entriesFor("driver.location_updated", { userId: 2 }).length, 0, "location pings are not activity");
    for (const type of ["auth.signed_in", "ride.completed", "payment.succeeded"]) assert.ok(activity.ACTIVITY_LABELS[type], type);
});

test("pagination: cursor is the last id, and only when there is more", () => {
    const rows = [{ id: 9 }, { id: 7 }, { id: 4 }];
    assert.deepEqual(toPage(rows, 2), { items: [{ id: 9 }, { id: 7 }], nextCursor: 7 });
    assert.deepEqual(toPage(rows.slice(0, 2), 2), { items: [{ id: 9 }, { id: 7 }], nextCursor: null });
    assert.equal(pageLimit({ limit: 1000 }), 100);
    assert.equal(pageLimit({}), 20);
    assert.equal(pageLimit({ limit: 0 }), 20);
});
