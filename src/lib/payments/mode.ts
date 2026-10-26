import { resolvePaymentProvider } from "../integrations";

export async function paymentMode(): Promise<"live" | "stripe_test" | "test" | "none"> {
  const p = await resolvePaymentProvider();
  if (!p) return "none";
  if (p.id === "test") return "test";
  return p.live ? "live" : "stripe_test";
}
