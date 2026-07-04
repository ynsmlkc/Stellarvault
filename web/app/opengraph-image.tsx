import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Stellar Vault — Confidential Multi-Sig Treasury on Stellar";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0A0A0B",
          padding: 80,
          fontFamily: "sans-serif",
        }}
      >
        {/* ambient gold glow */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -120,
            width: 620,
            height: 620,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at center, rgba(201,168,106,0.28), transparent 68%)",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            color: "#C9A86A",
            fontSize: 24,
            letterSpacing: 4,
          }}
        >
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#7FB069" }} />
          STELLAR · SOROBAN · ZERO-KNOWLEDGE
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 92, color: "#ECE7DD", lineHeight: 1.05 }}>Approve as a team.</div>
          <div style={{ fontSize: 92, color: "#C9A86A", fontStyle: "italic", lineHeight: 1.05 }}>
            Reveal nothing.
          </div>
          <div style={{ marginTop: 30, fontSize: 34, color: "#8A857B", maxWidth: 960 }}>
            Confidential multi-sig treasury — a ZK proof hides who approved, a shielded pool hides the amount + recipient.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 26,
            color: "#5a564d",
          }}
        >
          <div style={{ color: "#ECE7DD", letterSpacing: 3 }}>STELLAR VAULT</div>
          <div>Groth16 · Testnet · live</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
