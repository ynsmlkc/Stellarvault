/**
 * `F_r` field-element helpers (BN254 scalar field — Noir's `Field`, the Soroban
 * host's `Bn254Fr`). Everything the contract calls a "32-byte canonical
 * representative" lives here.
 */
/** Reduce into `[0, r)`. */
export declare function frMod(x: bigint): bigint;
/** Field addition mod `r`. */
export declare function frAdd(a: bigint, b: bigint): bigint;
/** Field subtraction mod `r`. */
export declare function frSub(a: bigint, b: bigint): bigint;
/**
 * Grumpkin SCALAR addition mod `p` (the group order), for accumulating
 * commitment blinding factors under homomorphic point addition:
 * `C1 + C2 = commit(v1 + v2, (r1 + r2) mod p)`. Reducing mod `r` here instead
 * silently opens the wrong commitment whenever the integer sum crosses `p`
 * (~50% of the time for two full-size blindings) — the resulting opening is
 * off by `p - r` and no longer matches the on-chain point (DESIGN §2.3).
 */
export declare function fpAdd(a: bigint, b: bigint): bigint;
/** True iff `x` is a canonical representative (`0 <= x < r`). */
export declare function isCanonicalFr(x: bigint): boolean;
/** 32-byte big-endian encoding (the on-chain `BytesN<32>` field layout). */
export declare function toBytes32BE(x: bigint): Uint8Array;
/** Decode a big-endian byte slice into a bigint. */
export declare function fromBytesBE(b: Uint8Array): bigint;
/** Decode a little-endian byte slice into a bigint (used by address_to_field). */
export declare function fromBytesLE(b: Uint8Array): bigint;
/** 0x-prefixed, zero-padded 32-byte hex. */
export declare function toHex32(x: bigint): string;
/** Parse 0x-prefixed (or bare) hex into a bigint. */
export declare function fromHex(h: string): bigint;
/** Lowercase hex (no 0x) for an arbitrary byte array. */
export declare function bytesToHex(b: Uint8Array): string;
/** Parse hex (with/without 0x) into bytes. */
export declare function hexToBytes(h: string): Uint8Array;
/** Cryptographically-random nonzero scalar in `[1, r)`. */
export declare function randomScalar(): bigint;
//# sourceMappingURL=field.d.ts.map