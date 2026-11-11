import { z } from "zod";
import config from "../../../../lib/config.ts";
import * as drivers from "../../../../services/drivers/service.ts";
import * as security from "../../../../lib/security.ts";
import * as sms from "../../../../lib/sms.ts";
import * as users from "../../../../services/users/service.ts";
import * as ratings from "../../../../services/ratings/service.ts";
import * as savedPlaces from "../../../../services/saved-places/service.ts";
import { createModule } from "../../core/route.ts";
import { IdParams, Ok } from "../../core/schemas.ts";
import { toDriver } from "../drivers/schemas.ts";
import { Me, ProfileBody, toUser } from "./schemas.ts";

/** The signed-in user, plus which onboarding step the app should show. */
export function me(userId: number) {
    const user = users.getById(userId)!;
    const next = users.onboardingStep(user);
    return {
        user: toUser(user),
        driver: user.role === "driver" ? toDriver(drivers.get(user.id)) : null,
        rating: ratings.summary(user.id),
        next,
        // In development the OTP SMS isn't really sent, so show it in the app.
        ...(!config.isProduction && next === "verify" ? { devSms: sms.latestForUser(user.id, 1)[0]?.message ?? null } : {})
    };
}

const { router, add } = createModule();
const tags = ["Account"];
const tenMinutes = 10 * 60 * 1000;

add({ method: "get", path: "/me", summary: "The signed-in user and their next onboarding step", tags, response: Me }, ({ user }) =>
    me(user.id)
);

add(
    {
        method: "post",
        path: "/onboarding/profile",
        summary: "Save name, phone and role; sends an SMS code",
        tags,
        before: [security.rateLimit({ windowMs: tenMinutes, max: 10 })],
        body: ProfileBody,
        response: Me,
        errors: [429]
    },
    ({ user, body }) => me(users.saveProfile(user.id, body).id)
);

add(
    {
        method: "post",
        path: "/onboarding/verify",
        summary: "Verify the phone with the SMS code",
        tags,
        before: [security.rateLimit({ windowMs: tenMinutes, max: 15 })],
        body: z.object({ code: z.string({ message: "Enter the 6-digit code." }).trim().max(10) }),
        response: Me,
        errors: [429]
    },
    ({ user, body }) => {
        users.verifyPhone(user, body.code);
        return me(user.id);
    }
);

add(
    {
        method: "post",
        path: "/onboarding/resend",
        summary: "Send a new SMS code",
        tags,
        before: [security.rateLimit({ windowMs: tenMinutes, max: 5 })],
        response: Me,
        errors: [429]
    },
    ({ user }) => {
        users.resendCode(user);
        return me(user.id);
    }
);

// ---- Saved places (Home, Work, ...) ----

const SavedPlace = z.object({ id: z.number(), label: z.string(), name: z.string(), lat: z.number(), lng: z.number() });
const toSavedPlace = ({ id, label, name, lat, lng }: z.infer<typeof SavedPlace>) => ({ id, label, name, lat, lng });

add(
    { method: "get", path: "/me/places", summary: "My saved places", tags, response: z.object({ places: z.array(SavedPlace) }) },
    ({ user }) => ({ places: savedPlaces.list(user.id).map(toSavedPlace) })
);

add(
    {
        method: "post",
        path: "/me/places",
        summary: "Save a place under a label (replaces the place with the same label)",
        tags,
        body: z.object({
            label: z.string({ message: "Give the place a label, e.g. Home." }).trim().min(1).max(30),
            name: z.string({ message: "Choose a place." }).trim().min(1).max(120),
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180)
        }),
        response: z.object({ place: SavedPlace }),
        errors: [409]
    },
    ({ user, body }) => ({ place: toSavedPlace(savedPlaces.save(user.id, body)) })
);

add(
    {
        method: "post",
        path: "/me/places/:id/delete",
        summary: "Remove a saved place",
        tags,
        params: IdParams,
        response: Ok,
        errors: [404]
    },
    ({ user, params }) => {
        savedPlaces.remove(user.id, params.id);
        return { ok: true as const };
    }
);

export default router;
