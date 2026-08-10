import { describe, expect, it } from "vitest";
import { argLabel, describeError, fieldTo32, proofTo256 } from "./contract";

describe("describeError", () => {
  it("names the guard that fired instead of showing a code", () => {
    expect(describeError(new Error("HostError: Error(Contract, #16)"))).toMatch(/Time-lock/);
    expect(describeError(new Error("... Error(Contract, #17) ..."))).toMatch(/allowlist/);
  });

  it("stays honest about codes it does not know", () => {
    expect(describeError(new Error("Error(Contract, #4242)"))).toBe("Contract rejected this (code 4242).");
  });

  it("passes non-contract failures through untouched", () => {
    expect(describeError(new Error("User declined the request"))).toBe("User declined the request");
    expect(describeError("plain string")).toBe("plain string");
  });

  // The map and the contract's error enum have drifted apart before — an entry
  // described a variant the contract never had, so a real error read as the
  // wrong explanation. This pins the two ends that are easy to get wrong.
  it("covers exactly codes 1..32, the contract's enum", () => {
    expect(describeError(new Error("Error(Contract, #32)"))).toMatch(/signer set changed/i);
    expect(describeError(new Error("Error(Contract, #33)"))).toMatch(/code 33/);
  });
});

describe("fieldTo32", () => {
  it("emits 32 big-endian bytes", () => {
    expect(Array.from(fieldTo32("1")).slice(-1)).toEqual([1]);
    expect(fieldTo32("1")).toHaveLength(32);
    expect(fieldTo32("255")[31]).toBe(255);
    expect(fieldTo32("256")[30]).toBe(1);
  });
});

describe("proofTo256", () => {
  // snarkjs writes each Fp2 coordinate as [c0, c1] — real part first — while
  // the BN254 host functions want be(c1)||be(c0). Getting this backwards builds
  // a verifier that rejects every valid proof, with nothing to point at.
  const proof = {
    pi_a: ["1", "2"],
    pi_b: [["10", "11"], ["20", "21"]],
    pi_c: ["3", "4"],
  };

  it("packs a || b || c into 256 bytes", () => {
    expect(proofTo256(proof)).toHaveLength(256);
  });

  it("reverses each G2 pair: x_c1, x_c0, y_c1, y_c0", () => {
    const out = proofTo256(proof);
    const at = (i: number) => out[i * 32 + 31]; // last byte of each 32-byte word
    expect([at(0), at(1)]).toEqual([1, 2]);        // a: as-is
    expect([at(2), at(3)]).toEqual([11, 10]);      // b.x reversed
    expect([at(4), at(5)]).toEqual([21, 20]);      // b.y reversed
    expect([at(6), at(7)]).toEqual([3, 4]);        // c: as-is
  });
});

describe("argLabel", () => {
  // These are the exact three arguments a `transfer` proposal carries, read
  // back off testnet through `scValToNative`.
  it("reads out a transfer the way a co-signer has to check it", () => {
    const [from, to, amount] = [
      "CBPWDYYIZNSN6MCXSAXMP7O5KNCWMO2FTOW2GNRKBEX4Y6BBRX3Z62OU",
      "GAV22INZRB3KWAPQODF6MYWY5T3HLIBBFZIQLLXKTUCYUAUHY3KIME26",
      2_500_000_000n,
    ].map(argLabel);
    expect(from.text).toBe("CBPWDY…3Z62OU");
    expect(from.title).toBe("CBPWDYYIZNSN6MCXSAXMP7O5KNCWMO2FTOW2GNRKBEX4Y6BBRX3Z62OU"); // full one on hover
    expect(to.text).toBe("GAV22I…KIME26");
    expect(amount.text).toBe("2,500,000,000");
    expect(amount.hint).toBe("250.00 at 7 decimals"); // the number a human can sanity-check
  });

  it("does not mistake a symbol or a short string for an address", () => {
    expect(argLabel("transfer")).toEqual({ text: "transfer" });
    expect(argLabel("GAV22INZ")).toEqual({ text: "GAV22INZ" });
  });

  it("renders the remaining Soroban types rather than dropping them", () => {
    expect(argLabel(true).text).toBe("true");
    expect(argLabel(42).text).toBe("42");
    expect(argLabel(new Uint8Array([0xde, 0xad, 0x01])).text).toBe("0xdead01");
    expect(argLabel([1n, "a"]).text).toBe('["1","a"]'); // nested vec, bigints kept readable
  });
});
