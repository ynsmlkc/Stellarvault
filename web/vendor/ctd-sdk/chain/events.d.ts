/**
 * Event ingestion over the Soroban RPC `getEvents` API — the ONLY source of
 * the protocol's client-visible secrets (encrypted amounts, salts, balance
 * checkpoints). There is no indexer.
 *
 * ⚠️ Retention: `getEvents` only serves roughly the last 7 days of ledgers.
 * Because spending requires re-deriving `v`/`r` from these events, a client
 * that misses an event before it expires can permanently lose the ability to
 * open the affected balance. The state engine (`state/`) therefore persists
 * decrypted state locally and must sync within the retention window. This is
 * the central, deliberate limitation of the demo.
 *
 * Events are soroban-sdk 26 `#[contractevent]` Map-format: `#[topic]` fields
 * become topics (after the event-name symbol), the rest become a data `ScMap`.
 */
import { type Point } from "../crypto/grumpkin.js";
import type { ChainClient } from "./client.js";
export type ConfidentialEventType = "register" | "deposit" | "merge" | "withdraw" | "transfer" | ComplianceEventType;
/**
 * Compliance + policy membership events. They share one shape — topics
 * `[symbol, account]` with NO data fields — and are emitted by the
 * `token_with_compliance` contract (`frozen`/`unfrozen`) and the standalone
 * allowlist/blocklist policy contracts (`user_*`). Note the on-chain symbol is
 * the snake_case of the soroban `#[contractevent]` struct name, so the
 * allowlist's `UserAllowed` struct emits `user_allowed` (NOT `allow`, despite
 * what the library docstrings say). They do not affect balance openings, so the
 * StateEngine ignores them; the token-admin dashboard replays them.
 */
export type ComplianceEventType = "frozen" | "unfrozen" | "user_allowed" | "user_disallowed" | "user_blocked" | "user_unblocked";
interface BaseEvent {
    type: ConfidentialEventType;
    ledger: number;
    txHash: string;
    /**
     * Source-independent event id ({@link naturalEventId}) — the SAME string
     * whether this event came from the RPC or the Goldsky indexer, so the two
     * sources dedupe and cross-resolve. This is NOT the RPC resume cursor; that
     * is the response-level {@link FetchEventsResult.cursor} (still an RPC paging
     * token), which is what the StateEngine persists between syncs.
     */
    cursor: string;
}
export interface RegisterEvent extends BaseEvent {
    type: "register";
    account: string;
    auditorId: number;
}
export interface DepositEvent extends BaseEvent {
    type: "deposit";
    from: string;
    to: string;
    amount: bigint;
}
export interface MergeEvent extends BaseEvent {
    type: "merge";
    account: string;
}
export interface WithdrawEvent extends BaseEvent {
    type: "withdraw";
    from: string;
    to: string;
    amount: bigint;
    rE: Point;
    sigma: bigint;
    bTilde: bigint;
    bAudS: bigint;
}
export interface TransferEvent extends BaseEvent {
    type: "transfer";
    from: string;
    to: string;
    rE: Point;
    vTilde: bigint;
    sigma: bigint;
    bTilde: bigint;
    vAudR: bigint;
    rAudR: bigint;
    vAudS: bigint;
    bAudS: bigint;
}
/** A compliance/policy membership event ({@link ComplianceEventType}). */
export interface ComplianceEvent extends BaseEvent {
    type: ComplianceEventType;
    /** The account that was frozen/unfrozen or added/removed from a policy list. */
    account: string;
}
export type ConfidentialEvent = RegisterEvent | DepositEvent | MergeEvent | WithdrawEvent | TransferEvent | ComplianceEvent;
/** The event-name symbols this client understands (topic[0]). Shared by the
 * RPC (XDR) and indexer (Goldsky-JSON) decoders so both accept the same set. */
export declare const KNOWN: ReadonlySet<string>;
/**
 * Source-agnostic accessor over an event's data `ScMap`, keyed by field name.
 * The RPC decoder backs it with XDR ({@link dataMap}); the indexer decoder backs
 * it with Goldsky JSON. {@link buildConfidentialEvent} is written against this
 * interface alone, so the two sources share ONE event-shape definition.
 */
export interface EventDataAccessor {
    field(name: string): bigint;
    point(name: string): Point;
    i128(name: string): bigint;
    u32(name: string): number;
}
/**
 * The single source of truth for each event type's shape: which topics are
 * addresses and which data fields are field elements / points / i128 / u32.
 * Both {@link parseEvent} (RPC/XDR) and `parseIndexerEvent` (Goldsky/JSON) call
 * this with their own `addr`/`data` adapters, so the field mapping cannot drift
 * between sources (the invariant the parity test guards). Returns `null` for
 * names outside {@link KNOWN}.
 */
export declare function buildConfidentialEvent(name: string, base: {
    ledger: number;
    txHash: string;
    cursor: string;
}, addr: (topicIndex: number) => string, data: EventDataAccessor): ConfidentialEvent | null;
export interface FetchEventsResult {
    events: ConfidentialEvent[];
    /** Last RPC cursor seen — pass back as `startCursor` to resume. */
    cursor: string | undefined;
    /** Latest ledger the RPC has, for staleness/retention checks. */
    latestLedger: number;
}
/**
 * Ledger sequence encoded in an RPC paging-token cursor (`<toid>-<event index>`,
 * where `toid = ledger << 32 | ...`). The cursor the RPC returns marks the end
 * of the ledger range it SCANNED, which can be far behind the chain head. Only
 * ever called on the RPC RESUME cursor ({@link FetchEventsResult.cursor}), never
 * on a per-event {@link BaseEvent.cursor} ({@link naturalEventId}).
 */
export declare function cursorLedger(cursor: string): number;
/**
 * Source-independent id for one on-chain event:
 * `${ledger}-${txHash}-${opIndex}-${eventIndex}`. The RPC and the Goldsky
 * indexer encode an event's coordinates differently (RPC: a `<toid>-<eventOrder>`
 * paging token; Goldsky: a `<ledger>-<txHash>-op-N-event-M` row id), but both
 * carry the same `(ledger, txHash, opIndex, eventIndex)`. Normalizing to this
 * string lets {@link dedupeById} and disclosure {@link resolveEventRef} treat
 * events from either source as one. It is used purely as a match key (it is NOT
 * bound into any proof's public inputs), so the format is free to change.
 */
export declare function naturalEventId(p: {
    ledger: number;
    txHash: string;
    opIndex: number;
    eventIndex: number;
}): string;
/**
 * Fetch and parse all confidential-token events from `startLedger` (or resume
 * from `startCursor`), following pagination to the end. Unknown event types
 * (config setters, spender ops) are skipped.
 */
export declare function fetchEvents(client: ChainClient, opts: {
    startLedger?: number;
    startCursor?: string;
    pageLimit?: number;
    contractId?: string;
}): Promise<FetchEventsResult>;
/**
 * Event reference (SELECTIVE_DISCLOSURE.md §5.1): pins one on-chain event.
 * `id` is the source-independent {@link naturalEventId} (same value as
 * {@link BaseEvent.cursor}), so a reference pinned from an RPC event resolves
 * against the indexer and vice-versa; `ledger`/`txHash` let the verifier bound
 * the lookup and cross-check the resolution. `id` is a match key only — it is
 * never part of any proof's public inputs (disclosure/verify.ts §5.2).
 */
export interface EventRef {
    ledger: number;
    id: string;
    txHash: string;
}
export declare const eventRef: (ev: ConfidentialEvent) => EventRef;
/**
 * Resolve an {@link EventRef} to the single on-chain event it names, reading
 * ONLY the referenced ledger from the RPC (ledger-range mode). Returns `null`
 * if no token-contract event with that id exists there — including when the
 * ledger has aged out of the RPC's ~7-day retention window, which is this
 * demo's accepted limitation. The disclosure verifier (disclosure/verify.ts)
 * treats the result as the sole source of event-derived public inputs.
 */
export declare function resolveEventRef(client: ChainClient, ref: EventRef): Promise<ConfidentialEvent | null>;
/**
 * Plain-JSON projection of a parsed event (bigints → 0x-hex, points → x/y
 * hex), with its {@link EventRef} attached as `ref`. This is the
 * copy-to-clipboard format the UI exposes so any third party can re-resolve
 * and inspect the event.
 */
export declare function eventToJson(ev: ConfidentialEvent): Record<string, unknown>;
export {};
//# sourceMappingURL=events.d.ts.map