import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// On Vercel, fall back to the project's production URL until SITE_URL is set explicitly.
if (!process.env.SITE_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  process.env.SITE_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
}

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; no third-party scripts are loaded.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://accounts.google.com",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(process.env.SITE_URL ? { env: { SITE_URL: process.env.SITE_URL } } : {}),
  serverExternalPackages: ["pg", "bcryptjs", "nodemailer"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
