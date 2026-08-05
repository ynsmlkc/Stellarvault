/**
 * Soroban RPC client: read-only simulation, full invoke (build → simulate →
 * assemble → sign → send → poll), and typed reads of confidential state.
 *
 * No indexer. State that the protocol exposes only through events is read with
 * the RPC `getEvents` API (see `events.ts`), accepting its ~7-day retention
 * window — the central trade-off of this demo.
 */
import { xdr, Address, Account, Contract, Keypair, TransactionBuilder, BASE_FEE, rpc, } from "@stellar/stellar-sdk";
import { pointFromBytes } from "../crypto/grumpkin.js";
/** Source used for read-only simulation; never signs, never pays. */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;
export function keypairSigner(secret, networkPassphrase) {
    const kp = Keypair.fromSecret(secret);
    return {
        publicKey: kp.publicKey(),
        async sign(txXdrBase64) {
            const tx = TransactionBuilder.fromXDR(txXdrBase64, networkPassphrase);
            tx.sign(kp);
            return tx.toXDR();
        },
    };
}
export class ChainClient {
    cfg;
    server;
    constructor(cfg) {
        this.cfg = cfg;
        this.server = new rpc.Server(cfg.rpcUrl, {
            allowHttp: cfg.rpcUrl.startsWith("http://"),
        });
    }
    // ----- reads -------------------------------------------------------------
    /** Simulate a read-only call and return its raw `ScVal` result. */
    async simulate(contractId, method, args) {
        const account = await this.server
            .getAccount(NULL_ACCOUNT)
            .catch(() => new Account(NULL_ACCOUNT, "0"));
        const tx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: this.cfg.networkPassphrase,
        })
            .addOperation(new Contract(contractId).call(method, ...args))
            .setTimeout(30)
            .build();
        const sim = await this.server.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(sim)) {
            throw new Error(`simulate ${method} failed: ${sim.error}`);
        }
        const ok = sim;
        if (!ok.result)
            throw new Error(`simulate ${method}: no result`);
        return ok.result.retval;
    }
    /** Read a confidential account, or `null` if `address` is not registered. */
    async confidentialBalance(address) {
        try {
            const retval = await this.simulate(this.cfg.contracts.token, "confidential_balance", [
                new Address(address).toScVal(),
            ]);
            return parseAccount(retval);
        }
        catch {
            return null;
        }
    }
    async isRegistered(address) {
        return (await this.confidentialBalance(address)) !== null;
    }
    /** Fetch auditor key `K_aud` (BytesN<64>) for an `auditor_id`. */
    async auditorKey(auditorId) {
        const retval = await this.simulate(this.cfg.contracts.auditor, "get_key", [
            xdr.ScVal.scvU32(auditorId),
        ]);
        return pointFromBytes(new Uint8Array(retval.bytes()));
    }
    async latestLedger() {
        return (await this.server.getHealth()).latestLedger;
    }
    // ----- writes ------------------------------------------------------------
    /**
     * Build, simulate, assemble, sign, submit, and poll a contract invocation.
     * Auth is taken from simulation; for these demo ops the source account is the
     * sole auth principal, so a single signature suffices.
     */
    async invoke(contractId, method, args, signer) {
        const source = await this.server.getAccount(signer.publicKey);
        const tx = new TransactionBuilder(source, {
            fee: BASE_FEE,
            networkPassphrase: this.cfg.networkPassphrase,
        })
            .addOperation(new Contract(contractId).call(method, ...args))
            .setTimeout(180)
            .build();
        const sim = await this.server.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(sim)) {
            throw new Error(`simulate ${method} failed: ${sim.error}`);
        }
        const assembled = rpc.assembleTransaction(tx, sim).build();
        const signedXdr = await signer.sign(assembled.toXDR());
        const signedTx = TransactionBuilder.fromXDR(signedXdr, this.cfg.networkPassphrase);
        const send = await this.server.sendTransaction(signedTx);
        if (send.status === "ERROR") {
            throw new Error(`send ${method} rejected: ${JSON.stringify(send.errorResult)}`);
        }
        for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
            await sleep(POLL_INTERVAL_MS);
            const res = await this.server.getTransaction(send.hash);
            if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND)
                continue;
            if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
                throw new Error(`${method} failed on-chain (tx ${send.hash})`);
            }
            return { hash: send.hash, status: res.status, returnValue: res.returnValue };
        }
        throw new Error(`${method} confirmation timed out (tx ${send.hash})`);
    }
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function parseAccount(val) {
    const entries = val.map();
    if (!entries)
        throw new Error("expected ScMap for ConfidentialAccount");
    const out = {};
    for (const e of entries) {
        const key = e.key().sym().toString();
        switch (key) {
            case "spending_key":
                out.spendingKey = pointFromBytes(new Uint8Array(e.val().bytes()));
                break;
            case "viewing_public_key":
                out.viewingPublicKey = pointFromBytes(new Uint8Array(e.val().bytes()));
                break;
            case "spendable_balance":
                out.spendableBalance = pointFromBytes(new Uint8Array(e.val().bytes()));
                break;
            case "receiving_balance":
                out.receivingBalance = pointFromBytes(new Uint8Array(e.val().bytes()));
                break;
            case "auditor_id":
                out.auditorId = e.val().u32();
                break;
        }
    }
    return out;
}
//# sourceMappingURL=client.js.map