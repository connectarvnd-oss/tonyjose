import { ImageResponse } from "next/og";

export const alt = "Tony Jose — Your next chapter starts somewhere.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#F4F0E8", color: "#161513", padding: "72px", fontFamily: "Georgia, serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, letterSpacing: 4, textTransform: "uppercase", fontFamily: "sans-serif" }}>
          <span>Tony Jose</span>
          <span>12 years of experience</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 104, lineHeight: 1, letterSpacing: -3 }}>
          <span>Your next chapter</span>
          <span>
            starts <span style={{ color: "#AA3A16", fontStyle: "italic", marginLeft: 24 }}>somewhere.</span>
          </span>
        </div>
        <div style={{ fontSize: 26, fontFamily: "sans-serif", color: "#666159" }}>Visa guidance · Study abroad &amp; admissions · Migration</div>
      </div>
    ),
    size,
  );
}
