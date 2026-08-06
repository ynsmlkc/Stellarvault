/**
 * Token-factory deploy helpers (advanced mode).
 *
 * The shared `TokenFactoryContract` deploys confidential-token instances from
 * WASM already installed on-chain (configured at the factory's construction).
 * The browser only INVOKES these methods via Freighter — it never installs
 * WASM. Each deploy derives a deterministic address from `(factory, salt)`, so
 * a fresh random salt per deploy avoids collisions.
 *
 * Arg tuples mirror the factory's Rust signatures by convention (the factory
 * deploys purely by hash + arg tuple); keep them in sync with
 * `contracts/factory/src/lib.rs`.
 */
import type { ChainClient, Signer } from "./client.js";
/** A fresh 32-byte salt — unique per `(factory, salt)` deploy. */
export declare function randomSalt(): Uint8Array;
/** Constant collaborators every factory deploy is wired to. */
export interface FactoryWiring {
    factory: string;
    underlying: string;
    verifier: string;
    auditor: string;
}
export type PolicyKind = "AllowList" | "BlockList";
/** `deploy_token(salt, underlying, verifier, auditor)` → vanilla token address. */
export declare function deployVanillaToken(client: ChainClient, signer: Signer, w: FactoryWiring, salt?: Uint8Array): Promise<string>;
/**
 * `deploy_compliant_token(salt, owner, underlying, verifier, auditor, policy?)`
 * → compliant token address. `policy` undefined ⇒ compliance-only (freeze + SAC
 * passthrough, no external policy); a policy address binds an existing policy.
 */
export declare function deployCompliantToken(client: ChainClient, signer: Signer, w: FactoryWiring, owner: string, policy?: string, salt?: Uint8Array): Promise<string>;
/**
 * `deploy_policy_and_token(kind, policy_salt, policy_owner, token_salt,
 * token_owner, underlying, verifier, auditor)` → `{ policy, token }`. Deploys a
 * fresh `owner`-owned policy (allowlist/blocklist) and a compliant token bound
 * to it in one call.
 */
export declare function deployPolicyAndToken(client: ChainClient, signer: Signer, w: FactoryWiring, kind: PolicyKind, owner: string, policySalt?: Uint8Array, tokenSalt?: Uint8Array): Promise<{
    policy: string;
    token: string;
}>;
//# sourceMappingURL=factory.d.ts.map