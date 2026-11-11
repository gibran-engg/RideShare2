-- Round 3: payments (placeholder gateway), per-user activity, idempotent writes, history indexes.

ALTER TABLE rides ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'card', 'upi'));
ALTER TABLE rides ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded'));

-- One payment per ride. Retried checkouts reuse the row (provider_ref is the latest session).
CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    ride_id INTEGER NOT NULL UNIQUE REFERENCES rides(id),
    rider_id INTEGER NOT NULL REFERENCES users(id),
    driver_id INTEGER REFERENCES users(id),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'upi')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
    provider TEXT NOT NULL,
    provider_ref TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT,
    refunded_at TEXT
);
CREATE INDEX idx_payments_rider ON payments(rider_id, id);
CREATE INDEX idx_payments_driver ON payments(driver_id, id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE UNIQUE INDEX idx_payments_provider_ref ON payments(provider_ref) WHERE provider_ref IS NOT NULL;

-- What each user did, for their timeline in the admin app.
CREATE TABLE activity_events (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    metadata TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activity_user ON activity_events(user_id, id);

-- Responses to POSTs sent with an Idempotency-Key, replayed when the same request is retried.
CREATE TABLE idempotency_keys (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    route TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
);

-- Rider and driver history pages, newest first.
CREATE INDEX idx_rides_rider_history ON rides(rider_id, id);
CREATE INDEX idx_rides_driver_history ON rides(driver_id, id);
