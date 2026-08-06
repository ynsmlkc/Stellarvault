/**
 * High-level submitters for each confidential-token entry point. Each combines
 * the witness payload, the proof bytes, and the plain method arguments into a
 * single `ChainClient.invoke`.
 *
 * Amounts are method arguments (`i128`), not part of the proof payload; the
 * proof binds the confidential debit/credit to the same value.
 */
import type { ChainClient, Signer, InvokeResult } from "./client.js";
import type { RegisterWitness } from "../witness/register.js";
import type { WithdrawWitness } from "../witness/withdraw.js";
import type { TransferWitness } from "../witness/transfer.js";
/** `register(account, auditor_id, data)`. */
export declare function submitRegister(client: ChainClient, signer: Signer, account: string, auditorId: number, witness: RegisterWitness, proof: Uint8Array): Promise<InvokeResult>;
/** `deposit(from, to, amount)` — public → confidential, no proof. */
export declare function submitDeposit(client: ChainClient, signer: Signer, from: string, to: string, amount: bigint): Promise<InvokeResult>;
/** `merge(account)` — fold receiving balance into spendable, no proof. */
export declare function submitMerge(client: ChainClient, signer: Signer, account: string): Promise<InvokeResult>;
/** `withdraw(from, to, amount, data)` — confidential → public. */
export declare function submitWithdraw(client: ChainClient, signer: Signer, from: string, to: string, amount: bigint, witness: WithdrawWitness, proof: Uint8Array): Promise<InvokeResult>;
/** `confidential_transfer(from, to, data)` — confidential → confidential. */
export declare function submitTransfer(client: ChainClient, signer: Signer, from: string, to: string, witness: TransferWitness, proof: Uint8Array): Promise<InvokeResult>;
//# sourceMappingURL=contract.d.ts.map