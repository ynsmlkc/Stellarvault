/**
 * State reconstruction from the contract event stream.
 *
 * Replays confidential-token events to recover the local openings (`v`, `r`) of
 * an account's spendable and receiving balances — the secrets needed to build
 * the next proof. Events come from the hybrid source (`chain/event-source.ts`):
 * the RPC `getEvents` API for the recent tail, plus an optional Goldsky indexer
 * for history older than the RPC's ~7-day retention window.
 *
 * Reconstruction rules (owner = `state.address`):
 *   - register(me)        → mark registered.
 *   - deposit(_, me)      → receiving += (amount, 0)   [deposits carry r = 0].
 *   - transfer(other, me) → ECDH-decrypt (v_tx, r_tx); receiving += (v_tx, r_tx).
 *   - merge(me)           → spendable += receiving; receiving = (0, 0).
 *   - withdraw(me, _)     → spendable = open(b_tilde, sigma)  [event encodes v_new].
 *   - transfer(me, _)     → spendable = open(b_tilde, sigma).
 *
 * Why the spendable rule needs no history: withdraw/transfer emit
 * `b_tilde = v_new + Poseidon2(ENC_BAL, vk, sigma)`, so the owner reads the
 * resulting spendable value straight from the event. The receiving balance,
 * however, is a running sum — every crediting event must be replayed. With
 * RPC alone those openings are only recoverable inside the ~7-day window, so a
 * client must persist state and sync at least once per retention period. A
 * configured indexer lifts this: crediting events stay available for the full
 * history, so a fresh client can reconstruct the receiving balance from scratch.
 */
import { type Point } from "../crypto/grumpkin.js";
import type { KeyPair } from "../crypto/keys.js";
import type { ChainClient } from "../chain/client.js";
import type { IndexerClient } from "../chain/indexer.js";
import type { StateStore } from "./store.js";
import { type AccountState, type Opening } from "./types.js";
export interface StateEngineConfig {
    client: ChainClient;
    store: StateStore;
    /** Owner's confidential key set (for ECDH decryption + balance opening). */
    keys: KeyPair;
    /** Owner's Stellar (G-) address (for event direction). */
    address: string;
    /**
     * Ledger to start the FIRST sync from (e.g. the contract deploy ledger).
     * When an {@link indexer} is provided this may predate the RPC retention
     * window — the hybrid source backfills the gap from the indexer.
     */
    fromLedger: number;
    /**
     * Optional Goldsky indexer for full-history backfill below the RPC's ~7-day
     * window. When omitted, sync is RPC-only (the original behavior): events
     * older than retention are unavailable.
     */
    indexer?: IndexerClient;
}
export declare class StateEngine {
    private cfg;
    constructor(cfg: StateEngineConfig);
    /** Recover an incoming transfer's amount and blinding from its event. */
    decryptIncoming(rE: Point, vTilde: bigint, sigma: bigint): {
        vTx: bigint;
        rTx: bigint;
    };
    /** Recover the owner's post-op spendable opening from an emitted b_tilde. */
    openSpendable(bTilde: bigint, sigma: bigint): Opening;
    /** Apply one event in-place to `state`. */
    private apply;
    /**
     * Sync from the last cursor (or `fromLedger` on first run), applying every
     * relevant event, then persist. Returns the updated state.
     */
    sync(): Promise<AccountState>;
    /** Read current state without syncing (or a fresh zero-state). */
    current(): Promise<AccountState>;
    /**
     * Optimistically overwrite the cached spendable opening after a successful
     * owner op, avoiding a round-trip wait for the event to land. A later
     * {@link sync} reconciles against the chain.
     */
    setSpendable(next: Opening): Promise<AccountState>;
    /**
     * Strong correctness check: the cached openings must re-commit to the exact
     * points stored on-chain. Mismatch means the local state diverged (a missed
     * event, an expired credit, or a bug) and is unsafe to spend from.
     */
    verifyAgainstChain(): Promise<{
        ok: boolean;
        spendableOk: boolean;
        receivingOk: boolean;
    }>;
}
//# sourceMappingURL=engine.d.ts.map