/**
 * Cross-language constants shared with the Noir circuits and the on-chain
 * contract. Every value here is a hard contract: if any of these diverges from
 * `circuits/lib/src/lib.nr` (generators, domain tags, IV base) or from the
 * Soroban host's field (the BN254 scalar field `F_r`), proofs silently fail to
 * verify or — worse — verify against the wrong statement.
 *
 * Source of truth:
 *   OpenZeppelin/stellar-contracts @ feat/confidential-verifier-ultrahonk
 *   packages/tokens/src/confidential/circuits/lib/src/lib.nr
 */
/**
 * BN254 scalar field order `r`. This is Noir's native `Field` modulus and the
 * Grumpkin **base** field (point coordinates live here). The Soroban host's
 * `Bn254Fr` is this field; "canonical" means a 32-byte big-endian value `< r`.
 */
export declare const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/**
 * BN254 base field order `p`. This is the Grumpkin **scalar** field — the
 * modulus that scalars are reduced by during point multiplication.
 *
 * Note `r < p`, so every `F_r` element (key material, blinding factors, salts —
 * all in `[0, r)`) is already a valid Grumpkin scalar with no reduction. That
 * is exactly why a Noir `Field` can be fed to `multi_scalar_mul` unambiguously.
 */
export declare const FP_MODULUS = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
/** Pedersen generator G (index 0). */
export declare const G_X = 3728882899078719075161482178784387565366481897740339799480980287259621149274n;
export declare const G_Y = 11985179162806396554955778097047359550576116765952231747549784474790041064285n;
/** Pedersen generator H (index 1). */
export declare const H_X = 2393473289045184898987089634332637236754766663897650125720167164137088869378n;
export declare const H_Y = 14752839959415467457196082350231122454649853219840744672802853620609001898278n;
/** IV multiplier: `iv = (input_length) * 2^64`, placed at the capacity slot. */
export declare const POSEIDON2_IV_BASE: bigint;
export declare const DOMAIN: {
    /** address_to_field(a) = Poseidon2(ADDRESS, lo, hi). */
    readonly ADDRESS: 1n;
    /** vk = Poseidon2(VIEWING_KEY, sk, addr_f). */
    readonly VIEWING_KEY: 2n;
    /** dvk = Poseidon2(DELEGATION_VIEWING_KEY, vk, op_i). */
    readonly DELEGATION_VIEWING_KEY: 3n;
    /** r' = Poseidon2(SPEND_RANDOMNESS, vk, sigma). */
    readonly SPEND_RANDOMNESS: 4n;
    /** r_tx = Poseidon2(TX_BLINDING, s, sigma). */
    readonly TX_BLINDING: 5n;
    /** v_tilde = v_tx + Poseidon2(TX_AMOUNT, s, sigma). */
    readonly TX_AMOUNT: 6n;
    /** b_tilde = v_new + Poseidon2(ENCRYPTED_BALANCE, vk, sigma). */
    readonly ENCRYPTED_BALANCE: 7n;
    /** a_tilde = v_a + Poseidon2(ENCRYPTED_ALLOWANCE, dvk, sigma_a). */
    readonly ENCRYPTED_ALLOWANCE: 8n;
    /** r_a = Poseidon2(ALLOWANCE_RANDOMNESS, dvk, sigma_a). */
    readonly ALLOWANCE_RANDOMNESS: 9n;
    /** escrowed_dvk = dvk + Poseidon2(ESCROWED_DELEGATION_VIEWING_KEY, s, op_i). */
    readonly ESCROWED_DELEGATION_VIEWING_KEY: 10n;
    /** Sender / owner-auditor channel tag. */
    readonly AUDITOR_SENDER: 11n;
    /** Recipient-auditor channel tag. */
    readonly AUDITOR_RECIPIENT: 12n;
    /**
     * Off-chain selective-disclosure ciphertext to a disclosure recipient:
     * `v_tilde_disc = v_tx + Poseidon2(DISCLOSURE, S_disc.x, nu)`.
     * SELECTIVE_DISCLOSURE.md §2.2 / §4 (`delta_disc`); continues the on-chain
     * tag list. Source of truth: packages/disclosure circuits.
     */
    readonly DISCLOSURE: 13n;
    /** Aggregate-disclosure nonce binding (`delta_disc_bind`, §10). Reserved. */
    readonly DISCLOSURE_BIND: 14n;
    /**
     * Wallet-side deterministic ephemeral scalar:
     * `r_e = Poseidon2(EPHEMERAL_KEY, vk, sigma)`. Never absorbed inside a
     * circuit — `r_e` is a free private witness there (only `R_e = r_e·H` and
     * `r_e ≠ 0` are constrained), so this is a client convention, not a wire
     * contract. It continues the tag list to stay collision-free with the other
     * `(vk, sigma)`-keyed calls (SPEND_RANDOMNESS, ENCRYPTED_BALANCE).
     */
    readonly EPHEMERAL_KEY: 15n;
};
/** Verifier circuit-type discriminants (verifier/mod.rs `CircuitType`). */
export declare const CIRCUIT_TYPE: {
    readonly Register: 0;
    readonly Withdraw: 1;
    readonly Transfer: 2;
    readonly SpenderTransfer: 3;
    readonly SetSpender: 4;
    readonly RevokeSpender: 5;
};
export type CircuitTypeName = keyof typeof CIRCUIT_TYPE;
//# sourceMappingURL=constants.d.ts.map