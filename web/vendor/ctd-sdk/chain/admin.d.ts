/**
 * Token-admin operations (admin persona).
 *
 * `token_with_compliance` exposes owner-gated `freeze`/`unfreeze`; the
 * allowlist/blocklist policy contracts expose owner-gated `allow`/`disallow`
 * and `block`/`unblock`. Reads go through `simulate`; writes through `invoke`,
 * where the owner's Freighter signature satisfies each `#[only_owner]` gate.
 *
 * Membership lists (frozen accounts, allowed/blocked users) are reconstructed
 * from the contract's events by the dashboard — these helpers cover the
 * point reads (owner / per-account status) and the mutations.
 */
import type { ChainClient, Signer, InvokeResult } from "./client.js";
/**
 * Read a contract's Ownable owner, or `null` if it has none / errors.
 *
 * The OZ `Ownable` trait exposes `get_owner() -> Option<Address>` (NOT `owner`).
 * soroban encodes the `Option` as the address ScVal for `Some`, or `Void` for
 * `None` (owner unset / renounced) — so a `Void` result means "no owner".
 */
export declare function readOwner(client: ChainClient, contractId: string): Promise<string | null>;
/** `is_frozen(account)` on a compliant token. */
export declare function isFrozen(client: ChainClient, tokenId: string, account: string): Promise<boolean>;
/** `allowed(account)` on an allowlist policy. */
export declare function isAllowed(client: ChainClient, policyId: string, account: string): Promise<boolean>;
/** `blocked(account)` on a blocklist policy. */
export declare function isBlocked(client: ChainClient, policyId: string, account: string): Promise<boolean>;
/** `freeze(account, operator)` — `operator` is the authorizing owner. */
export declare function freezeAccount(client: ChainClient, signer: Signer, tokenId: string, account: string, operator: string): Promise<InvokeResult>;
/** `unfreeze(account, operator)`. */
export declare function unfreezeAccount(client: ChainClient, signer: Signer, tokenId: string, account: string, operator: string): Promise<InvokeResult>;
/** `allow(user)` on an allowlist policy. */
export declare function allowUser(client: ChainClient, signer: Signer, policyId: string, user: string): Promise<InvokeResult>;
/** `disallow(user)` on an allowlist policy. */
export declare function disallowUser(client: ChainClient, signer: Signer, policyId: string, user: string): Promise<InvokeResult>;
/** `block(user)` on a blocklist policy. */
export declare function blockUser(client: ChainClient, signer: Signer, policyId: string, user: string): Promise<InvokeResult>;
/** `unblock(user)` on a blocklist policy. */
export declare function unblockUser(client: ChainClient, signer: Signer, policyId: string, user: string): Promise<InvokeResult>;
//# sourceMappingURL=admin.d.ts.map