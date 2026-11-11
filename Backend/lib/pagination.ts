import type { Page, PageQuery } from "./types.ts";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export function pageLimit(query: PageQuery = {}): number {
    return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.limit || DEFAULT_PAGE_SIZE)));
}

/**
 * Keyset pagination on a descending integer id. Callers fetch limit + 1 rows with
 * `id < cursor`; the extra row only tells us whether there is another page.
 */
export function toPage<T extends { id: number }>(rows: T[], limit: number): Page<T> {
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.id : null };
}
