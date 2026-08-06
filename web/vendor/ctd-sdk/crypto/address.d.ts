/**
 * `address_to_field` — Poseidon2 compression of a Stellar strkey into one
 * `F_r` element, matching `storage.rs::address_to_field`.
 *
 * The contract takes the 56-character strkey ASCII (`C…` for contracts, `G…`
 * for accounts), splits it into two 28-byte limbs, interprets each
 * little-endian as a field element, and hashes `Poseidon2(ADDRESS, lo, hi)`.
 *
 * This value is the domain separator baked into every account's viewing key
 * (`vk = Poseidon2(VIEWING_KEY, sk, addr_f)`), so it MUST equal the
 * contract's stored `AddressAsField`. The deploy/e2e flow asserts that equality
 * against the on-chain value as a guard against any Poseidon2 drift.
 */
/**
 * @param strkey - The Stellar strkey string (e.g. a `C…` contract address).
 */
export declare function addressToField(strkey: string): bigint;
//# sourceMappingURL=address.d.ts.map