import path from "node:path";
import express from "express";
import type { Request } from "express";
import { AppError } from "../../lib/errors.ts";
import * as activity from "../../services/activity/service.ts";
import * as audit from "../../lib/audit.ts";
import config from "../../lib/config.ts";
import * as drivers from "../../services/drivers/service.ts";
import * as payments from "../../services/payments/service.ts";
import * as rideState from "../../services/rides/state.ts";
import * as rides from "../../services/rides/service.ts";
import * as sms from "../../lib/sms.ts";
import * as users from "../../services/users/service.ts";
import type { RideStatus, VerificationStatus } from "../../lib/types.ts";

const router = express.Router();

function id(req: Request): number {
    return Number.parseInt(String(req.params.id), 10) || 0;
}

function cursor(req: Request): number | null {
    return Number.parseInt(String(req.query.cursor || ""), 10) || null;
}

router.get("/", (req, res) => {
    res.render("dashboard", {
        title: "Overview",
        stats: rides.stats(),
        pending: drivers.list("pending").slice(0, 5),
        activeRides: rideState.ACTIVE_STATUSES.flatMap((status) => rides.list({ status, limit: 20 }).items),
        recent: rides.list({ limit: 8 }).items
    });
});

// ---- Driver verification ----

router.get("/drivers", (req, res) => {
    const status = (["pending", "approved", "rejected"] as const).find((s) => s === req.query.status) ?? "";
    res.render("drivers", { title: "Drivers", status, drivers: drivers.list(status as VerificationStatus | "") });
});

router.get("/drivers/:id", (req, res) => {
    const driver = drivers.get(id(req));
    if (!driver) throw new AppError("NOT_FOUND", "Driver not found.");
    res.render("driver", {
        title: driver.name,
        driver,
        trips: rides.historyFor(driver.user_id, "driver", { limit: 20 }).items,
        earnings: rides.earnings(driver.user_id)
    });
});

router.post("/drivers/:id/approve", (req, res) => {
    drivers.review(id(req), req.admin!.id, "approved");
    req.flash!("success", "Driver approved and notified by SMS.");
    res.redirect("/drivers?status=pending");
});

router.post("/drivers/:id/reject", (req, res) => {
    const reason = String(req.body.reason || "")
        .trim()
        .slice(0, 300);
    drivers.review(id(req), req.admin!.id, "rejected", reason);
    req.flash!("success", "Driver asked to resubmit.");
    res.redirect("/drivers?status=pending");
});

/** Uploaded documents are only served to signed-in admins. */
router.get("/documents/:name", (req, res) => {
    const name = String(req.params.name);
    if (!/^[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(name)) throw new AppError("NOT_FOUND", "Document not found.");
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(path.join(config.uploadDir, name), { dotfiles: "deny" }, (err) => {
        if (err && !res.headersSent) res.status(404).send("Document not found.");
    });
});

// ---- Users ----

router.get("/users", (req, res) => {
    const search = String(req.query.q || "")
        .trim()
        .slice(0, 80);
    const role = req.query.role === "rider" || req.query.role === "driver" ? req.query.role : "";
    res.render("users", { title: "Users", search, role, users: users.list({ search, role }) });
});

const USER_TABS = ["rides", "trips", "payments", "activity"] as const;
type UserTab = (typeof USER_TABS)[number];

/** Everything about one user: profile, rides taken, trips made, payments and their activity timeline. */
router.get("/users/:id", (req, res) => {
    const user = users.getById(id(req));
    if (!user) throw new AppError("NOT_FOUND", "User not found.");
    const defaultTab: UserTab = user.role === "driver" ? "trips" : "rides";
    const tab = USER_TABS.find((t) => t === req.query.tab) ?? defaultTab;
    const page = { cursor: cursor(req), limit: 25 };

    const content =
        tab === "rides"
            ? rides.historyFor(user.id, "rider", page)
            : tab === "trips"
              ? rides.historyFor(user.id, "driver", page)
              : tab === "payments"
                ? payments.forUser(user.id, user.role === "driver" ? "driver" : "rider", page)
                : activity.listFor(user.id, page);

    res.render("user", {
        title: user.name || user.email,
        user,
        driver: user.role === "driver" ? drivers.get(user.id) : null,
        tab,
        tabs: USER_TABS,
        items: content.items,
        nextCursor: content.nextCursor,
        riderSummary: rides.riderSummary(user.id),
        earnings: user.role === "driver" ? rides.earnings(user.id) : null
    });
});

router.post("/users/:id/status", (req, res) => {
    const status = req.body.status === "suspended" ? "suspended" : "active";
    if (id(req) === req.admin!.id) throw new AppError("BAD_REQUEST", "You can't suspend your own account.");
    users.setStatus(id(req), status, req.admin!.id);
    req.flash!("success", status === "suspended" ? "User suspended and signed out." : "User reinstated.");
    res.redirect(req.body.back === "user" ? `/users/${id(req)}` : "/users");
});

// ---- Rides ----

const RIDE_STATUSES: RideStatus[] = ["requested", "accepted", "arrived", "in_progress", "completed", "cancelled"];

router.get("/rides", (req, res) => {
    const status = RIDE_STATUSES.find((s) => s === req.query.status) ?? "";
    const result = rides.list({ status, cursor: cursor(req), limit: 50 });
    res.render("rides", { title: "Rides", status, statuses: RIDE_STATUSES, rides: result.items, nextCursor: result.nextCursor });
});

router.get("/rides/:id", (req, res) => {
    const ride = rides.get(id(req));
    if (!ride) throw new AppError("NOT_FOUND", "Ride not found.");
    res.render("ride", { title: `Ride #${ride.id}`, ride, payment: payments.ofRide(ride.id) });
});

router.post("/rides/:id/cancel", (req, res) => {
    const reason =
        String(req.body.reason || "")
            .trim()
            .slice(0, 300) || "Cancelled by support";
    rides.cancel(id(req), { by: "admin", userId: req.admin!.id, reason });
    req.flash!("success", "Ride cancelled. Rider and driver were notified.");
    res.redirect(`/rides/${id(req)}`);
});

// ---- Payments ----

router.get("/payments", (req, res) => {
    const result = payments.all({ cursor: cursor(req), limit: 50 });
    res.render("payments", { title: "Payments", payments: result.items, nextCursor: result.nextCursor, stats: rides.stats() });
});

router.post("/payments/:id/refund", (req, res) => {
    const reason =
        String(req.body.reason || "")
            .trim()
            .slice(0, 300) || "Refunded by support";
    const payment = payments.refund(id(req), req.admin!.id, reason);
    req.flash!("success", "Payment marked as refunded.");
    res.redirect(`/rides/${payment.ride_id}`);
});

// ---- Logs ----

router.get("/messages", (req, res) => {
    res.render("messages", { title: "SMS log", messages: sms.recent(200) });
});

router.get("/audit", (req, res) => {
    res.render("audit", { title: "Audit log", entries: audit.recent(200) });
});

export default router;
