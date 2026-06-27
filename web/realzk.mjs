import { rpc, TransactionBuilder, BASE_FEE, Contract, Address, nativeToScVal, scValToNative, xdr, Keypair } from "@stellar/stellar-sdk";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
const RPC="https://soroban-testnet.stellar.org", PASS="Test SDF Network ; September 2015";
const VAULT="CDSIBLZ3LQ5CEXKPWQNE5IWAMVNDYAYNMSLB4ECXTRQAQYLEZWF42YKM";
const kp=Keypair.fromSecret("SD7P42DMATKXXZJTU425YJQQSW6IX3F662CSYTLUAALTUETHE2UKDLOQ");
const me=kp.publicKey(); const server=new rpc.Server(RPC);
const u64=n=>nativeToScVal(BigInt(n),{type:"u64"}),u32=n=>nativeToScVal(n,{type:"u32"}),i128=n=>nativeToScVal(n,{type:"i128"}),adr=a=>new Address(a).toScVal(),bool=b=>nativeToScVal(b),addrVec=xs=>xdr.ScVal.scvVec(xs.map(a=>new Address(a).toScVal()));
async function call(m,args){const acct=await server.getAccount(me);const tx=new TransactionBuilder(acct,{fee:BASE_FEE,networkPassphrase:PASS}).addOperation(new Contract(VAULT).call(m,...args)).setTimeout(60).build();const prep=await server.prepareTransaction(tx);prep.sign(kp);const sent=await server.sendTransaction(prep);let res=await server.getTransaction(sent.hash);let i=0;while(res.status==="NOT_FOUND"&&i<30){await new Promise(r=>setTimeout(r,1000));res=await server.getTransaction(sent.hash);i++;}console.log(`  [${m}] -> ${res.status}`);if(res.status!=="SUCCESS")console.log("  detail:",JSON.stringify(res).slice(0,300));return res.returnValue?scValToNative(res.returnValue):null;}
// --- generate a REAL voteApproval proof ---
const pos=await buildPoseidon(); const F=pos.F; const H=a=>BigInt(F.toString(pos(a.map(x=>F.e(x)))));
const rand=()=>{let h="";for(let i=0;i<62;i++)h+=Math.floor(Math.random()*16).toString(16);return BigInt("0x"+h);};
const vaultId=99n, txHash=H([99n,0n]), secret=rand(), blinding=rand(), commit=H([secret,vaultId,blinding]);
const leaves=[]; for(let i=0;i<16;i++)leaves.push(i===5?commit:rand());
let layers=[leaves],lvl=leaves; while(lvl.length>1){const nx=[];for(let i=0;i<lvl.length;i+=2)nx.push(H([lvl[i],lvl[i+1]]));layers.push(nx);lvl=nx;}
const root=layers[4][0]; const pe=[],pi=[]; let idx=5; for(let l=0;l<4;l++){const sib=idx%2===0?idx+1:idx-1;pe.push(layers[l][sib]);pi.push(idx%2);idx=Math.floor(idx/2);}
const nullifier=H([commit,txHash]);
const input={vaultId:vaultId.toString(),txHash:txHash.toString(),signerRoot:root.toString(),nullifier:nullifier.toString(),signerSecret:secret.toString(),blinding:blinding.toString(),pathElements:pe.map(String),pathIndices:pi.map(String)};
const {proof,publicSignals}=await snarkjs.groth16.fullProve(input,"public/zk-wasm/voteApproval.wasm","public/zk-wasm/voteApproval_final.zkey");
console.log("real proof generated. publicSignals:",publicSignals.length);
// --- EXACT frontend encoding ---
function f32(dec){let h=BigInt(dec).toString(16);h=h.length>64?h.slice(-64):h.padStart(64,"0");const o=new Uint8Array(32);for(let i=0;i<32;i++)o[i]=parseInt(h.substr(i*2,2),16);return o;}
function p256(pf){const parts=[pf.pi_a[0],pf.pi_a[1],pf.pi_b[0][0],pf.pi_b[0][1],pf.pi_b[1][0],pf.pi_b[1][1],pf.pi_c[0],pf.pi_c[1]];const o=new Uint8Array(256);parts.forEach((p,i)=>o.set(f32(p),i*32));return o;}
const entry=(k,v)=>new xdr.ScMapEntry({key:xdr.ScVal.scvSymbol(k),val:v});
function zk(txId){return xdr.ScVal.scvMap([entry("nullifier",nativeToScVal(BigInt(publicSignals[3]),{type:"u256"})),entry("proof",nativeToScVal(p256(proof))),entry("public_inputs",xdr.ScVal.scvVec(publicSignals.map(s=>nativeToScVal(f32(s))))),entry("tx_id",u64(txId))]);}
// --- create vault, private propose, approve_zk ---
const vid=Number(await call("create_vault",[adr(me),addrVec([me]),u32(1)])); console.log("vault",vid);
const tid=Number(await call("propose_transaction",[u64(vid),adr(me),adr(me),i128(10000000n),bool(true)])); console.log("private tx",tid);
console.log("→ approve_zk with REAL proof + frontend encoding:");
await call("approve_zk",[u64(vid),u64(tid),adr(me),zk(tid)]);
