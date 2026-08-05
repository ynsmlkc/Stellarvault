/**
 * Hybrid event source: RPC for the recent tail, the Goldsky indexer for the
 * portion older than the RPC's ~7-day retention window.
 *
 * Strategy ("RPC tip + indexer backfill"):
 *   next = cursor ? cursorLedger(cursor)+1 : fromLedger
 *   if indexer configured AND next < rpcOldest:
 *     - indexer covers [next, rpcOldest-1]   (only it has these)
 *     - RPC covers      [rpcOldest, head]    (clean ledger boundary)
 *   else:
 *     - RPC only, from the stored cursor (warm) or clamp(fromLedger, rpcOldest)
 *
 * Because the indexer leg ends at `rpcOldest-1` and the RPC leg starts at
 * `rpcOldest`, the two ranges are disjoint by construction — correctness does
 * NOT depend on cross-source id equality. {@link dedupeById} is only a
 * belt-and-suspenders guard for the boundary ledger (and because
 * `StateEngine.apply` is not idempotent, a stray duplicate would double-count).
 *
 * The indexer is OPTIONAL: when `indexer` is `undefined`, this degrades to
 * RPC-only behavior (pre-window history simply unavailable) — a deliberate
 * configuration choice. But when a *configured* indexer's backfill call
 * throws (a transient network/Worker hiccup), the error PROPAGATES instead of
 * degrading silently: StateEngine.sync() would otherwise still complete using
 * only the RPC leg and persist its cursor, which permanently commits every
 * future sync to the warm, indexer-skipping path (see below) — turning one
 * transient failure into unrecoverable data loss for that client.
 */
import { type ConfidentialEvent, type EventRef, type FetchEventsResult } from "./events.js";
import type { ChainClient } from "./client.js";
import type { IndexerClient } from "./indexer.js";
/**
 * Deduplicate events by their canonical id (`cursor`), preserving input order
 * within a ledger and sorting only by ledger. The caller passes events already
 * in apply order ([indexer-old, …rpc-recent], disjoint ledger ranges), so a
 * STABLE sort by ledger keeps each source's intra-ledger order intact — we do
 * NOT re-sort by id string, which would misorder same-ledger events if the
 * indexer's ids aren't zero-padded. `StateEngine.apply` is order-sensitive
 * (a merge after a deposit in one ledger), so this ordering is load-bearing.
 */
export declare function dedupeById(events: ConfidentialEvent[]): ConfidentialEvent[];
/**
 * Fetch events covering `[next, head]`, splitting across the indexer (old) and
 * the RPC (recent) per the strategy above. Returns the same shape as
 * {@link fetchEvents}; `cursor` is always the RPC resume cursor (the only one
 * the StateEngine persists).
 */
export declare function hybridFetchEvents(client: ChainClient, indexer: IndexerClient | undefined, opts: {
    fromLedger: number;
    startCursor?: string;
    contractId?: string;
}): Promise<FetchEventsResult>;
/**
 * Resolve a pinned event, trying the RPC first and falling back to the indexer.
 *
 * The common case — verifying a freshly-created disclosure — pins a recent event
 * the RPC serves in one call, and the RPC is the fresher, authoritative source
 * (the indexer lags the chain head). Only when the RPC yields nothing — because
 * the event aged out of the ~7-day window, which surfaces as either a thrown
 * out-of-range error or an empty result — do we fall back to the indexer's
 * durable full history. Both sources resolve to the same event (ids are
 * normalized via `naturalEventId`), so the order is a pure latency choice that
 * favors the hot path.
 */
export declare function hybridResolveEventRef(client: ChainClient, indexer: IndexerClient | undefined, ref: EventRef): Promise<ConfidentialEvent | null>;
//# sourceMappingURL=event-source.d.ts.map