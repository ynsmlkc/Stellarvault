/**
 * Grumpkin curve operations (the embedded curve of BN254), wrapping
 * `@noble/curves`.
 *
 *   - Equation: `y^2 = x^3 - 17`
 *   - Base field  (coordinates): BN254 `F_r`  — Noir's `Field`
 *   - Scalar field (multipliers): BN254 `F_p`
 *
 * Generators G and H are Barretenberg's `derive_generators(
 * "DEFAULT_DOMAIN_SEPARATOR")` outputs (indices 0 and 1), matching
 * `circuits/lib/src/lib.nr`. There is NO known discrete-log relation between
 * them — do not assume `H = k·G`.
 *
 * On-chain a point is `BytesN<64>` = `be(x) || be(y)`, and the identity is all
 * 64 bytes zero. `pointToBytes` / `pointFromBytes` implement exactly that.
 */
import { type WeierstrassPoint } from "@noble/curves/abstract/weierstrass";
/** Grumpkin base field = BN254 `F_r` (point coordinates; Noir `Field`). */
export declare const Fr: Readonly<import("@noble/curves/abstract/modular").IField<bigint> & Required<Pick<import("@noble/curves/abstract/modular").IField<bigint>, "isOdd">>>;
/** Grumpkin scalar field = BN254 `F_p` (multipliers). */
export declare const Fp: Readonly<import("@noble/curves/abstract/modular").IField<bigint> & Required<Pick<import("@noble/curves/abstract/modular").IField<bigint>, "isOdd">>>;
/**
 * Grumpkin curve. The nominal base point is generator G itself, so
 * `Grumpkin.BASE === G`. `allowInfinityPoint` lets us represent the identity
 * (a registered account's opening balance commitment is the identity).
 */
export declare const Grumpkin: import("@noble/curves/abstract/weierstrass").WeierstrassPointCons<bigint>;
export type Point = WeierstrassPoint<bigint>;
/** Pedersen generator G (index 0). */
export declare const G: Point;
/** Pedersen generator H (index 1). */
export declare const H: Point;
/** The point at infinity / identity element. */
export declare const IDENTITY: Point;
/** True iff `p` is the identity (encoded on-chain as 64 zero bytes). */
export declare function isIdentity(p: Point): boolean;
/**
 * `scalar · P`. The scalar is an `F_r` value (key, blinding, salt); since
 * `r < p` it is always a valid Grumpkin scalar with no reduction. We reduce
 * mod `p` defensively and map `0` to the identity (noble rejects a zero
 * multiplier).
 */
export declare function scalarMul(scalar: bigint, p: Point): Point;
/** Pedersen commitment `v·G + r·H`. */
export declare function commit(value: bigint, randomness: bigint): Point;
/** ECDH shared-secret x-coordinate: `(scalar · P).x`. Throws on identity. */
export declare function ecdh(scalar: bigint, p: Point): bigint;
/** Affine coordinates, returning `(0, 0)` for the identity. */
export declare function pointCoords(p: Point): {
    x: bigint;
    y: bigint;
};
/** Encode to the on-chain 64-byte `be(x) || be(y)` layout (identity → zeros). */
export declare function pointToBytes(p: Point): Uint8Array;
/** Decode the on-chain 64-byte layout (all-zero → identity). */
export declare function pointFromBytes(b: Uint8Array): Point;
//# sourceMappingURL=grumpkin.d.ts.map