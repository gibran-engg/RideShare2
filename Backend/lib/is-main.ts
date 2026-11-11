import path from "node:path";
import { fileURLToPath } from "node:url";

/** True when the module at `metaUrl` is the script Node was started with (portable import.meta.main). */
export function isMain(metaUrl: string): boolean {
    return Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(metaUrl);
}
