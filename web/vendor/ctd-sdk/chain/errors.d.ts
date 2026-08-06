/**
 * Human-readable messages for on-chain contract errors.
 *
 * Soroban surfaces a failed contract call as a `HostError` whose string carries
 * `Error(Contract, #NNNN)`, where `NNNN` is a `#[contracterror]` discriminant.
 * The raw HostError (with its diagnostic event log) is unreadable in a UI, so
 * this maps the known codes — from the confidential-token, compliance, ownable,
 * and access-control error enums — to plain language.
 *
 * Codes mirror the contracts' error enums; keep in sync if those change:
 *   - AccessControlError 2000–2009  (stellar_access::access_control)
 *   - OwnableError       2100–2102  (stellar_access::ownable)
 *   - ConfidentialTokenError 3500–3514
 *   - ComplianceError    3600–3603
 */
export declare const CONTRACT_ERRORS: Readonly<Record<number, string>>;
/** The contract error code embedded in a raw HostError string, or `null`. */
export declare function parseContractErrorCode(raw: string): number | null;
/**
 * Translate a raw error string to a friendly message when it carries a known
 * contract error code; otherwise `null` (caller falls back to the raw text).
 */
export declare function humanizeContractError(raw: string): string | null;
//# sourceMappingURL=errors.d.ts.map