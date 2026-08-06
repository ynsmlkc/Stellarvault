// Can the auditor channel be neutered?
//
// Every confidential transfer emits a ciphertext to a registered auditor key,
// by design. If that key had no known discrete log — a "nothing up my sleeve"
// point, derived by hashing a fixed string onto the curve rather than by
// multiplying the generator — then the ciphertexts would be undecryptable by
// anyone, and the channel would be dead while still being structurally present.
//
// The open question is whether the circuits accept such a key, or whether they
// assume a real keypair exists somewhere. This finds out.
//
// Usage: OWNER_SECRET=… pnpm --filter @ctd/sdk exec tsx ../../scripts/nothing-up-my-sleeve.ts

import { createHash } from "node:crypto";
import { Keypair, xdr, Address, nativeToScVal } from "@stellar/stellar-sdk";
import { ChainClient, keypairSigner } from "../packages/sdk/src/chain/client.js";
import { Grumpkin, Fr, pointToBytes, scalarMul, type Point } from "../packages/sdk/src/crypto/grumpkin.js";
import { deriveKeys, type KeyPair } from "../packages/sdk/src/crypto/keys.js";
import { addressToField } from "../packages/sdk/src/crypto/address.js";
import { randomScalar } from "../packages/sdk/src/crypto/field.js";
import { buildRegisterWitness } from "../packages/sdk/src/witness/register.js";
import { buildTransferWitness } from "../packages/sdk/src/witness/transfer.js";
import { encodeRegisterData, encodeTransferData } from "../packages/sdk/src/chain/payload.js";
import { CircuitProver } from "../packages/sdk/src/proving/prover.js";
import { loadCircuit } from "../packages/sdk/src/proving/artifacts.js";
import { StateEngine, MemoryStore } from "../packages/sdk/src/state/index.js";
import { RPC_URL, PASSPHRASE, loadDeployment } from "./_shared.js";

const NEW_AUDITOR_ID = 1;
const DEPOSIT = 1000n;
const TRANSFER = 400n;

const owner = Keypair.fromSecret(process.env.OWNER_SECRET!);
const dep = loadDeployment();

/**
 * Hash a fixed string onto the curve. Because the point comes from a hash and
 * not from k·G, nobody knows a `k` for it — which is exactly the property that
 * would make the auditor channel undecryptable.
 */
function nothingUpMySleeve(tag: string): Point {
  for (let i = 0; i < 1000; i++) {
    const h = createHash("sha256").update(`${tag}|${i}`).digest("hex");
    const x = Fr.create(BigInt("0x" + h));
    // y² = x³ - 17
    const y2 = Fr.create(x * x * x - 17n);
    const y = Fr.sqrt?.(y2);
    if (y === undefined) continue;
    try {
      const p = Grumpkin.fromAffine({ x, y });
      p.assertValidity();
      return p;
    } catch {
      continue;
    }
  }
  throw new Error("no point found");
}

async function main() {
  const client = new ChainClient({
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    contracts: { token: dep.contracts.token, verifier: dep.contracts.verifier, auditor: dep.contracts.auditor },
  });
  const signer = keypairSigner(owner.secret(), PASSPHRASE);
  const addrF = addressToField(dep.contracts.token);

  const kNull = nothingUpMySleeve("stellar-vault/no-auditor/v1");
  const { x, y } = kNull.toAffine();
  console.log("nothing-up-my-sleeve auditor key");
  console.log(`  x = ${x.toString(16).slice(0, 24)}…`);
  console.log(`  y = ${y.toString(16).slice(0, 24)}…`);
  console.log("  on curve: ok, discrete log: unknown to anyone\n");

  console.log(`→ registering it as auditor ${NEW_AUDITOR_ID} …`);
  await client.invoke(
    dep.contracts.auditor,
    "register_key",
    [
      xdr.ScVal.scvU32(NEW_AUDITOR_ID),
      nativeToScVal(Buffer.from(pointToBytes(kNull)), { type: "bytes" }),
      new Address(owner.publicKey()).toScVal(),
    ],
    signer
  );
  const readBack: Point = await client.auditorKey(NEW_AUDITOR_ID);
  console.log(`  registry accepted it: ${readBack.toAffine().x === x}\n`);

  // two fresh accounts, both bound to the keyless auditor
  const mk = async (label: string) => {
    const kp = Keypair.random();
    await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
    const keys: KeyPair = deriveKeys(randomScalar(), addrF);
    const w = buildRegisterWitness(keys);
    const { proof } = await new CircuitProver(loadCircuit("register")).prove(w.inputs);
    await client.invoke(
      dep.contracts.token,
      "register",
      [new Address(kp.publicKey()).toScVal(), xdr.ScVal.scvU32(NEW_AUDITOR_ID), encodeRegisterData(w, proof)],
      keypairSigner(kp.secret(), PASSPHRASE)
    );
    console.log(`  ${label} registered under auditor ${NEW_AUDITOR_ID}`);
    return { kp, keys, signer: keypairSigner(kp.secret(), PASSPHRASE) };
  };

  console.log("→ registering two accounts against it …");
  const alice = await mk("alice");
  const bob = await mk("bob");

  console.log("\n→ funding alice …");
  const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
  await client.invoke(
    dep.contracts.token,
    "deposit",
    [new Address(alice.kp.publicKey()).toScVal(), new Address(alice.kp.publicKey()).toScVal(), i128(DEPOSIT)],
    alice.signer
  );
  await client.invoke(dep.contracts.token, "merge", [new Address(alice.kp.publicKey()).toScVal()], alice.signer);

  const engine = new StateEngine({
    client, store: new MemoryStore(), keys: alice.keys,
    address: alice.kp.publicKey(), fromLedger: dep.deployedAtLedger,
  });
  const s = await engine.sync();
  console.log(`  alice spendable = ${s.spendable.v}`);

  console.log("\n→ the real test: a transfer whose auditor ciphertext nobody can open …");
  const kAud = await client.auditorKey(NEW_AUDITOR_ID);
  const w = buildTransferWitness({
    keys: alice.keys, v: s.spendable.v, r: s.spendable.r, amount: TRANSFER,
    pvkB: (await client.confidentialBalance(bob.kp.publicKey()))!.viewingPublicKey,
    kAudR: kAud, kAudS: kAud,
  });
  const { proof } = await new CircuitProver(loadCircuit("transfer")).prove(w.inputs);
  await client.invoke(
    dep.contracts.token,
    "confidential_transfer",
    [
      new Address(alice.kp.publicKey()).toScVal(),
      new Address(bob.kp.publicKey()).toScVal(),
      encodeTransferData(w, proof),
    ],
    alice.signer
  );

  const after = await engine.sync();
  console.log(`  transfer accepted on-chain`);
  console.log(`  alice spendable = ${after.spendable.v} (was ${DEPOSIT})`);
  if (after.spendable.v !== DEPOSIT - TRANSFER) throw new Error("balance did not move as expected");

  console.log("\nRESULT — the circuits accept an auditor key with no known discrete log.");
  console.log("The channel stays structurally present but is undecryptable by anyone,");
  console.log("which is 'confidential, full stop' without forking the contracts.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message ?? e);
  console.error("If the circuits reject the key, that is the answer: the auditor");
  console.error("channel cannot be neutered this way.");
  process.exit(1);
});
