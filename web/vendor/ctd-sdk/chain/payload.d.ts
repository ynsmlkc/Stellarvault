/**
 * XDR encoding of the `{ payload, proof }` envelopes that the proof-carrying
 * entry points (`register`, `withdraw`, `confidential_transfer`, …) decode from
 * their `data: Bytes` argument via `RegisterData::from_xdr` etc.
 *
 * Layout, per `storage.rs`:
 *   - A `#[contracttype]` struct serializes to `ScVal::Map` with `Symbol` keys
 *     (the field names), entries sorted ascending by key.
 *   - `Point = BytesN<64>` is a FLAT 64-byte value (`be(x) || be(y)`), NOT an
 *     `{ x, y }` sub-map (that was the previous design).
 *   - `BytesN<32>` fields are 32-byte values; `proof` is variable `Bytes`.
 *
 * The `data` argument itself is `Bytes`, so the wire value is
 * `scvBytes( ScVal(<XDR of the {payload, proof} map>) )`.
 */
import { xdr } from "@stellar/stellar-sdk";
import type { RegisterWitness } from "../witness/register.js";
import type { WithdrawWitness } from "../witness/withdraw.js";
import type { TransferWitness } from "../witness/transfer.js";
/** A contracttype struct: ScMap with symbol keys sorted ascending (byte order). */
export declare function scvStruct(fields: Record<string, xdr.ScVal>): xdr.ScVal;
export declare function encodeRegisterData(w: RegisterWitness, proof: Uint8Array): xdr.ScVal;
export declare function encodeWithdrawData(w: WithdrawWitness, proof: Uint8Array): xdr.ScVal;
export declare function encodeTransferData(w: TransferWitness, proof: Uint8Array): xdr.ScVal;
//# sourceMappingURL=payload.d.ts.map