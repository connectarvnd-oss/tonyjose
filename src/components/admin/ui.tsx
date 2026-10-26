import Link from "next/link";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="font-display text-4xl md:text-5xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, children, id, className = "" }: { title?: string; description?: string; children: React.ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={`scroll-mt-24 rounded-lg border border-line bg-white/50 p-5 md:p-6 ${className}`}>
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className={title || description ? "mt-5" : ""}>{children}</div>
    </section>
  );
}

const tones: Record<string, string> = {
  green: "bg-success/10 text-success",
  red: "bg-danger/10 text-danger",
  amber: "bg-amber-100 text-amber-900",
  grey: "bg-ink/[0.06] text-charcoal",
  blue: "bg-sky-100 text-sky-900",
};

export function Badge({ tone = "grey", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [keyof typeof tones, string]> = {
    confirmed: ["green", "Confirmed"],
    pending_payment: ["amber", "Awaiting payment"],
    cancelled: ["grey", "Cancelled"],
    completed: ["blue", "Completed"],
    no_show: ["red", "No-show"],
    expired: ["grey", "Expired"],
    payment_failed: ["red", "Payment failed"],
    needs_attention: ["red", "Needs attention"],
  };
  const [tone, label] = map[status] ?? ["grey", status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, [keyof typeof tones, string]> = {
    not_required: ["grey", "Free"],
    pending: ["amber", "Pending"],
    paid: ["green", "Paid"],
    failed: ["red", "Failed"],
    expired: ["grey", "Not completed"],
    refund_pending: ["amber", "Refund pending"],
    refunded: ["blue", "Refunded"],
    partially_refunded: ["blue", "Part refunded"],
  };
  const [tone, label] = map[status] ?? ["grey", status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Stat({ label, value, hint, href }: { label: string; value: React.ReactNode; hint?: string; href?: string }) {
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 font-display text-4xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  const cls = "block rounded-lg border border-line bg-white/50 p-5 transition-colors";
  return href ? (
    <Link href={href} className={`${cls} hover:border-ink`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Flash({ message, tone = "green" }: { message?: string | null; tone?: "green" | "red" }) {
  if (!message) return null;
  return (
    <div role="status" className={`mb-6 rounded-md px-4 py-3 text-sm ${tone === "green" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
      {message}
    </div>
  );
}

export const inputCls =
  "block w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink";
export const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wider text-muted";
export const btnCls = "inline-flex items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-accent disabled:opacity-50";
export const btnSecondaryCls =
  "inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-ink disabled:opacity-50";
export const btnDangerCls = "inline-flex items-center justify-center gap-2 rounded-md bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ink disabled:opacity-50";

export function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
