/**
 * Soroban RPC client: read-only simulation, full invoke (build → simulate →
 * assemble → sign → send → poll), and typed reads of confidential state.
 *
 * No indexer. State that the protocol exposes only through events is read with
 * the RPC `getEvents` API (see `events.ts`), accepting its ~7-day retention
 * window — the central trade-off of this demo.
 */
import { xdr, rpc } from "@stellar/stellar-sdk";
import { type Point } from "../crypto/grumpkin.js";
/**
 * Minimal transaction signer. A Node script wraps a {@link Keypair} via
 * {@link keypairSigner}; the web app wraps Freighter's `signTransaction`.
 */
export interface Signer {
    /** G-address of the signer (transaction source / auth principal). */
    publicKey: string;
    /** Sign an assembled transaction (base64 XDR) and return signed base64 XDR. */
    sign(txXdrBase64: string): Promise<string>;
}
export interface ContractIds {
    token: string;
    verifier: string;
    auditor: string;
}
export interface ChainConfig {
    rpcUrl: string;
    networkPassphrase: string;
    contracts: ContractIds;
}
export interface InvokeResult {
    hash: string;
    status: string;
    /** Return value of the invoked function (if any). */
    returnValue?: xdr.ScVal;
}
/** On-chain confidential account (`confidential_balance` return value). */
export interface OnChainAccount {
    spendingKey: Point;
    viewingPublicKey: Point;
    spendableBalance: Point;
    receivingBalance: Point;
    auditorId: number;
}
export declare function keypairSigner(secret: string, networkPassphrase: string): Signer;
export declare class ChainClient {
    readonly cfg: ChainConfig;
    readonly server: rpc.Server;
    constructor(cfg: ChainConfig);
    /** Simulate a read-only call and return its raw `ScVal` result. */
    simulate(contractId: string, method: string, args: xdr.ScVal[]): Promise<xdr.ScVal>;
    /** Read a confidential account, or `null` if `address` is not registered. */
    confidentialBalance(address: string): Promise<OnChainAccount | null>;
    isRegistered(address: string): Promise<boolean>;
    /** Fetch auditor key `K_aud` (BytesN<64>) for an `auditor_id`. */
    auditorKey(auditorId: number): Promise<Point>;
    latestLedger(): Promise<number>;
    /**
     * Build, simulate, assemble, sign, submit, and poll a contract invocation.
     * Auth is taken from simulation; for these demo ops the source account is the
     * sole auth principal, so a single signature suffices.
     */
    invoke(contractId: string, method: string, args: xdr.ScVal[], signer: Signer): Promise<InvokeResult>;
}
//# sourceMappingURL=client.d.ts.map