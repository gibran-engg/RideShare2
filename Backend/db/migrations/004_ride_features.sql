-- Round 7 (merged into uber-video-run): pricing segments, OTP issued on arrival, chat, ratings,
-- richer driver onboarding, hours online, cancellation fees, SOS, trip sharing and saved places.

-- Fare breakdown, fixed when the ride is booked.
ALTER TABLE rides ADD COLUMN pricing_segment TEXT NOT NULL DEFAULT 'normal'
    CHECK (pricing_segment IN ('normal', 'peak', 'night'));
ALTER TABLE rides ADD COLUMN fare_multiplier REAL NOT NULL DEFAULT 1;
ALTER TABLE rides ADD COLUMN fare_base REAL;
ALTER TABLE rides ADD COLUMN fare_distance REAL;
ALTER TABLE rides ADD COLUMN fare_time REAL;

-- The trip OTP is now created when the driver arrives and expires (milliseconds since the epoch).
ALTER TABLE rides ADD COLUMN otp_expires_at INTEGER;
ALTER TABLE rides ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0;

-- Charged when a rider cancels after the driver has arrived; it goes to the driver.
ALTER TABLE rides ADD COLUMN cancellation_fee INTEGER NOT NULL DEFAULT 0;

-- Safety: when someone pressed SOS, and the secret for the rider's "share my trip" link.
ALTER TABLE rides ADD COLUMN sos_at TEXT;
ALTER TABLE rides ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX idx_rides_share_token ON rides(share_token) WHERE share_token IS NOT NULL;

-- Driver onboarding: licence expiry, vehicle year and insurance.
ALTER TABLE drivers ADD COLUMN license_expiry TEXT;
ALTER TABLE drivers ADD COLUMN vehicle_year INTEGER;
ALTER TABLE drivers ADD COLUMN insurance_doc TEXT;
ALTER TABLE drivers ADD COLUMN insurance_expiry TEXT;

-- Hours online today: the current session's start plus the seconds from earlier sessions that day.
ALTER TABLE drivers ADD COLUMN online_since TEXT;
ALTER TABLE drivers ADD COLUMN online_day TEXT;
ALTER TABLE drivers ADD COLUMN online_seconds_today INTEGER NOT NULL DEFAULT 0;

-- Messages between the rider and driver of a ride.
CREATE TABLE ride_messages (
    id INTEGER PRIMARY KEY,
    ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ride_messages_ride ON ride_messages(ride_id, id);

-- After a completed trip, rider and driver each rate the other once.
CREATE TABLE ride_ratings (
    id INTEGER PRIMARY KEY,
    ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    rater_id INTEGER NOT NULL REFERENCES users(id),
    ratee_id INTEGER NOT NULL REFERENCES users(id),
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    tags TEXT,
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (ride_id, rater_id)
);
CREATE INDEX idx_ride_ratings_ratee ON ride_ratings(ratee_id);

-- A rider's saved places (Home, Work, ...), one per label.
CREATE TABLE saved_places (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, label)
);
