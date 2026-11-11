import * as users from "../../../../services/users/service.ts";
import { createModule } from "../../core/route.ts";
import { Ok } from "../../core/schemas.ts";

/**
 * Sign-in itself happens between the app and Auth0 (Authorization Code + PKCE); the API never sees
 * a password or a login code, only the resulting JWT access token on each request.
 */
const { router, add } = createModule();
const tags = ["Auth"];

add(
    { method: "post", path: "/auth/logout", summary: "Record a sign-out (the app discards its tokens)", tags, response: Ok },
    ({ user }) => {
        users.signOut(user.id);
        return { ok: true };
    }
);

export default router;
