import * as _MD from "@memoized-dom/runtime";
import * as _MDD from "@memoized-dom/data/internal";
_MDD.describeModuleSource("./session.ts#currentUser", () => {
  return _MDD.createSource('/api/session');
});
_MDD.describeModuleSource("./session.ts#notifications", () => {
  return _MDD.createSource('/api/notifications');
});
/**
 * Workspace data layer — RFC colorless module sources.
 *
 * Module-scope sources are lazy descriptions: nothing runs at import time.
 * The active DataRuntime (installed in main.ts) materializes them on first
 * read, per runtime — request-local on the server.
 */
import { $fetch } from '@memoized-dom/data';
/** Session source — consumed by any component via plain value reads. */
export const currentUser = _MDD.sourceRef("./session.ts#currentUser");

/** Notifications source — a list; Group supplies its pending/error arms. */
export const notifications = _MDD.sourceRef("./session.ts#notifications");