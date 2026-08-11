import { describe, expect, it } from "vitest";
import { formatXLM, formatXLMExact, shortAddr, shortContract, toStroops, toStroopsSafe, xlmExact } from "./stellar";

describe("toStroops", () => {
  it("converts whole and fractional amounts", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("12.5")).toBe(125_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
  });

  it("accepts the grouping the app itself prints", () => {
    expect(toStroops("1,000")).toBe(10_000_000_000n);
    expect(toStroops("1,234.56")).toBe(12_345_600_000n);
  });

  // The reason this is string-based: Number("9007199.2547409") * 1e7 is no
  // longer an integer, and rounding it silently moves the wrong amount.
  it("stays exact past the float-safe range", () => {
    expect(toStroops("92233720368.5477580")).toBe(922_337_203_685_477_580n);
    expect(toStroops("9007199.2547409")).toBe(90_071_992_547_409n);
  });

  it("refuses amounts a reader could interpret two ways", () => {
    // "1,5" is 1.5 in tr-TR and malformed in en-US. Guessing would move 15 XLM.
    expect(() => toStroops("1,5")).toThrow();
    expect(() => toStroops("1.2.3")).toThrow();
    expect(() => toStroops("12,34")).toThrow();
  });

  it("refuses what cannot be paid", () => {
    expect(() => toStroops("")).toThrow();
    expect(() => toStroops("0")).toThrow();
    expect(() => toStroops("-5")).toThrow();
    expect(() => toStroops("abc")).toThrow();
    expect(() => toStroops("1.00000001")).toThrow(); // 8dp: XLM has 7
  });

  it("round-trips through the formatter", () => {
    expect(formatXLM(toStroops("1,234.56"))).toBe("1,234.56");
  });

  it("toStroopsSafe reports failure instead of throwing", () => {
    expect(toStroopsSafe("abc")).toBeNull();
    expect(toStroopsSafe("2.5")).toBe(25_000_000n);
  });
});

describe("formatXLMExact", () => {
  // The whole point of listing a batch line by line is that a line can't lie.
  it("shows stroops the display formatter would hide", () => {
    expect(formatXLM(1n)).toBe("0.00");
    expect(formatXLMExact(1n)).toBe("0.0000001");
    expect(formatXLMExact(99_999_999_999n)).toBe("9,999.9999999");
  });

  it("still reads like money when there is nothing to hide", () => {
    expect(formatXLMExact(12_500_000n)).toBe("1.25");
    expect(formatXLMExact(10_000_000n)).toBe("1.00");
    expect(formatXLMExact(0n)).toBe("0.00");
  });
});

describe("xlmExact", () => {
  it("keeps every stroop, unlike the two-decimal display formatter", () => {
    expect(xlmExact(10_050_000n)).toBe("1.005");
    expect(formatXLM(10_050_000n)).toBe("1.00"); // why the display one can't prefill a form
  });

  it("trims to the shortest exact spelling", () => {
    expect(xlmExact(10_000_000n)).toBe("1");
    expect(xlmExact(0n)).toBe("0");
    expect(xlmExact(1n)).toBe("0.0000001");
  });

  // Guards prefills its limit boxes with this and saves whatever is in them, so
  // a value that did not survive the round trip would silently rewrite policy.
  it("round-trips through toStroops", () => {
    for (const v of [1n, 10_000_000n, 10_050_000n, 922_337_203_685_477_580n, 123_456_789n]) {
      expect(toStroops(xlmExact(v))).toBe(v);
    }
  });
});

describe("formatXLM", () => {
  it("truncates rather than rounds, so a balance never reads high", () => {
    expect(formatXLM(19_999_999n)).toBe("1.99");
  });

  it("groups thousands", () => {
    expect(formatXLM(12_345_600_000n)).toBe("1,234.56");
  });

  it("handles zero and sub-cent dust", () => {
    expect(formatXLM(0n)).toBe("0.00");
    expect(formatXLM(1n)).toBe("0.00");
  });
});

describe("address shorteners", () => {
  const g = "GAV22INZRB3KWAPQODF6MYWY5T3HLIBBFZIQLLXKTUCYUAUHY3KIME26";
  const c = "CANCA3UTGWFYIQO4VV5AW4QUC5GKC3QHNQMCMUUN6OHA3AMIDSOSAOY2";

  it("keeps both ends so two addresses stay distinguishable", () => {
    expect(shortAddr(g, 6, 4)).toBe("GAV22I…ME26");
    expect(shortContract(c)).toBe("CANC…AOY2");
  });
});

describe("the amount parser is the only amount parser", () => {
  // Two float parsers existed, not one. Removing `stroopsFromXlm` from
  // page.tsx left `parseAmountToStroops` on the single-payment path — the
  // most-used path in the app — where Number("1,5") * 1e7 proposed 15 XLM,
  // while the review panel beside it used toStroops and displayed 0.00. A
  // grep is a blunt test, but the failure was that nobody was looking.
  it("no float-scaled parser survives in the app source", async () => {
    const fs = await import("node:fs/promises");
    const sources = ["app/page.tsx", "app/confidential.tsx", "lib/contract.ts"];
    for (const f of sources) {
      const src = await fs.readFile(f, "utf8");
      const code = src
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
        .join("\n");
      expect(code, `${f} scales an amount through a float`).not.toMatch(/\*\s*1e7/);
    }
  });

  it("refuses the input that made the two disagree", () => {
    expect(() => toStroops("1,5")).toThrow();
    expect(toStroopsSafe("1,5")).toBeNull();
  });
});
