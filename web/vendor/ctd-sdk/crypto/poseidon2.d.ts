/**
 * Poseidon2 over BN254 `F_r`, reconstructed on top of the raw permutation from
 * `@zkpassport/poseidon2` so the sponge matches `circuits/lib/src/lib.nr`
 * byte-for-byte. We deliberately do NOT use the package's own `poseidon2Hash`
 * sponge — its padding/IV convention is its own and we cannot let it drift from
 * the circuit's.
 *
 * Sponge (lib.nr `sponge`): width 4, rate 3, capacity 1.
 *   - `iv = len * 2^64` placed at `state[3]`; state starts `[0,0,0,iv]`.
 *   - absorb 3 elements at a time by ADDING into `state[0..3]`, then permute.
 *   - one trailing permute for any non-multiple-of-3 remainder.
 *   - squeeze `state[0]`.
 *
 * `poseidon_with_domain(d, inputs)` prepends the domain tag, so it is just
 * `sponge([d, ...inputs])`.
 */
/** Generic sponge over `F_r`, matching `lib.nr::sponge`. */
export declare function sponge(inputs: bigint[]): bigint;
/** The single Poseidon2 funnel: domain tag is always the first absorbed field. */
export declare function poseidonWithDomain(d: bigint, inputs: bigint[]): bigint;
/**
 * Two-squeeze sponge (`lib.nr::sponge_squeeze_2`): absorbs `(d, s_x, sigma)`
 * in one block and returns `[state[0], state[1]]`. Index 0 is the amount mask,
 * index 1 is the balance/randomness mask.
 */
export declare function spongeSqueeze2(d: bigint, sx: bigint, sigma: bigint): [bigint, bigint];
/** `vk = Poseidon2(VIEWING_KEY, sk, addr_f)`. */
export declare const vkFromSk: (sk: bigint, addrF: bigint) => bigint;
/** `dvk = Poseidon2(DELEGATION_VIEWING_KEY, vk, op_i)`. */
export declare const dvkFromVkOp: (vk: bigint, opI: bigint) => bigint;
/** `r' = Poseidon2(SPEND_RANDOMNESS, vk, sigma)`. */
export declare const deriveSpendR: (vk: bigint, sigma: bigint) => bigint;
/** `r_a = Poseidon2(ALLOWANCE_RANDOMNESS, dvk, sigma_a)`. */
export declare const deriveAllowR: (dvk: bigint, sigmaA: bigint) => bigint;
/** `r_tx = Poseidon2(TX_BLINDING, s, sigma)`. */
export declare const deriveTxBlind: (s: bigint, sigma: bigint) => bigint;
/**
 * Deterministic ephemeral scalar `r_e = Poseidon2(EPHEMERAL_KEY, vk, sigma)`.
 *
 * The circuits leave `r_e` a free witness, so deriving it (instead of
 * sampling) changes nothing on-chain — but it lets the SENDER re-derive the
 * scalar for any past outgoing transfer from `vk` plus the event's public
 * `sigma`, which is what makes D-sender disclosures work without retaining
 * per-transfer state. Uniqueness comes from `sigma` (fresh per attempt,
 * DESIGN.md §9.6); secrecy from `vk`. Throws on the ~2⁻²⁵⁴-probability zero
 * output (T8/W8 require `r_e ≠ 0`) — resample `sigma` if that ever happens.
 */
export declare const deriveEphemeralRE: (vk: bigint, sigma: bigint) => bigint;
/** `v_tilde = v_tx + Poseidon2(TX_AMOUNT, s, sigma)`. */
export declare const encryptAmount: (vTx: bigint, s: bigint, sigma: bigint) => bigint;
/** `b_tilde = v_new + Poseidon2(ENCRYPTED_BALANCE, vk, sigma)`. */
export declare const encryptBalance: (vNew: bigint, vk: bigint, sigma: bigint) => bigint;
/** `a_tilde = v_a + Poseidon2(ENCRYPTED_ALLOWANCE, dvk, sigma_a)`. */
export declare const encryptAllowance: (vA: bigint, dvk: bigint, sigmaA: bigint) => bigint;
/** `escrowed_dvk = dvk + Poseidon2(ESCROWED_DELEGATION_VIEWING_KEY, s, op_i)`. */
export declare const encryptEscDvk: (dvk: bigint, s: bigint, opI: bigint) => bigint;
/** `b_tilde_aud_s = v_new + Poseidon2(AUDITOR_SENDER, s_a_s_x, sigma)`. */
export declare const encryptAuditorSenderBalance: (vNew: bigint, sAsX: bigint, sigma: bigint) => bigint;
/**
 * `v_tilde_disc = v_tx + Poseidon2(DISCLOSURE, s_disc_x, nu)` — the U3 stage
 * of every selective-disclosure circuit (SELECTIVE_DISCLOSURE.md §4). The
 * recipient inverts it with {@link decryptWithDomain} after ECDH-recovering
 * `s_disc_x` from the bundle's `R_disc`.
 */
export declare const encryptDisclosure: (vTx: bigint, sDiscX: bigint, nu: bigint) => bigint;
/**
 * Decrypt a scalar ciphertext: `plaintext = ciphertext - Poseidon2(tag, ...)`.
 * Used by the state engine to recover `v_new` from an emitted `b_tilde`, etc.
 */
export declare const decryptWithDomain: (ciphertext: bigint, d: bigint, a: bigint, b: bigint) => bigint;
//# sourceMappingURL=poseidon2.d.ts.map