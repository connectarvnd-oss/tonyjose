import { formatPrice } from "../content";
import { formatTimeRange, zoneLabel } from "../format";
import type { Settings } from "../settings";

export type EmailContext = {
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  clientCountry?: string | null;
  typeName: string;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  paymentStatus: string;
  reference: string;
  start: Date;
  end: Date;
  clientTimeZone: string;
  businessTimeZone: string;
  manageUrl: string;
  meetingLink?: string | null;
  meetingInstructions?: string | null;
  enquiryArea?: string | null;
  message?: string | null;
  adminUrl?: string;
  cancellationRules: string;
  extra?: string | null;
  refundNote?: string | null;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function fill(template: string, ctx: EmailContext) {
  const map: Record<string, string> = {
    name: ctx.clientName.split(" ")[0] || ctx.clientName,
    fullName: ctx.clientName,
    type: ctx.typeName,
    date: formatTimeRange(ctx.start, ctx.end, ctx.clientTimeZone),
    reference: ctx.reference,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => map[k] ?? "");
}

function detailRows(ctx: EmailContext, forAdmin = false): [string, string][] {
  const rows: [string, string][] = [
    ["Consultation", `${ctx.typeName} · ${ctx.durationMinutes} minutes`],
    ["When", `${formatTimeRange(ctx.start, ctx.end, ctx.clientTimeZone)} (${zoneLabel(ctx.clientTimeZone, ctx.start)})`],
  ];
  if (ctx.clientTimeZone !== ctx.businessTimeZone) {
    rows.push(["Tony's time", `${formatTimeRange(ctx.start, ctx.end, ctx.businessTimeZone)} (${zoneLabel(ctx.businessTimeZone, ctx.start)})`]);
  }
  rows.push(["Price", ctx.priceCents === 0 ? "Free" : `${formatPrice(ctx.priceCents, ctx.currency)} · ${paymentLabel(ctx.paymentStatus)}`]);
  rows.push(["Reference", ctx.reference]);
  if (ctx.meetingLink) rows.push(["Meeting link", ctx.meetingLink]);
  else if (ctx.meetingInstructions) rows.push(["Meeting", ctx.meetingInstructions]);
  if (forAdmin) {
    rows.push(["Client", `${ctx.clientName} <${ctx.clientEmail}>`]);
    if (ctx.clientPhone) rows.push(["Phone", ctx.clientPhone]);
    if (ctx.clientCountry) rows.push(["Country", ctx.clientCountry]);
    if (ctx.enquiryArea) rows.push(["Area", ctx.enquiryArea]);
    if (ctx.message) rows.push(["Message", ctx.message]);
  }
  return rows;
}

export function paymentLabel(status: string) {
  return (
    {
      not_required: "No payment required",
      pending: "Payment pending",
      paid: "Paid",
      failed: "Payment failed",
      expired: "Payment not completed",
      refund_pending: "Refund in progress",
      refunded: "Refunded",
      partially_refunded: "Partially refunded",
    } as Record<string, string>
  )[status] ?? status;
}

function layout(opts: { heading: string; intro: string; rows: [string, string][]; cta?: { label: string; url: string }; footer: string[]; signature: string }) {
  const rowsHtml = opts.rows
    .map(
      ([k, v]) => `<tr><td style="padding:10px 0;border-top:1px solid #e3ded4;color:#6b665e;font-size:13px;width:34%;vertical-align:top">${esc(k)}</td><td style="padding:10px 0;border-top:1px solid #e3ded4;font-size:14px;color:#1a1917">${
        /^https?:\/\//.test(v) ? `<a href="${esc(v)}" style="color:#b23c17">${esc(v)}</a>` : esc(v).replace(/\n/g, "<br>")
      }</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1917">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b665e;margin:0 0 32px">Tony Jose</p>
<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:30px;line-height:1.15;margin:0 0 16px">${esc(opts.heading)}</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 24px">${esc(opts.intro).replace(/\n/g, "<br>")}</p>
<table style="width:100%;border-collapse:collapse;margin:0 0 28px">${rowsHtml}</table>
${opts.cta ? `<p style="margin:0 0 28px"><a href="${esc(opts.cta.url)}" style="display:inline-block;background:#1a1917;color:#f4f1ea;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:14px">${esc(opts.cta.label)}</a></p>` : ""}
${opts.footer.map((f) => `<p style="font-size:13px;line-height:1.6;color:#6b665e;margin:0 0 12px">${esc(f)}</p>`).join("")}
<p style="font-size:14px;margin:24px 0 0">${esc(opts.signature)}</p>
</div></body></html>`;
  const text = [
    opts.heading,
    "",
    opts.intro,
    "",
    ...opts.rows.map(([k, v]) => `${k}: ${v}`),
    "",
    ...(opts.cta ? [`${opts.cta.label}: ${opts.cta.url}`, ""] : []),
    ...opts.footer,
    "",
    opts.signature,
  ].join("\n");
  return { html, text };
}

const DISCLAIMER =
  "Consultations provide guidance only and do not guarantee visa approval, admission, or any migration outcome.";

export type TemplateName =
  | "client_confirmation"
  | "client_reminder"
  | "client_cancellation"
  | "client_reschedule"
  | "client_payment_issue"
  | "admin_new_booking"
  | "admin_cancellation"
  | "admin_reschedule";

export function renderEmail(name: TemplateName, ctx: EmailContext, email: Settings["email"]) {
  const t = email.templates;
  switch (name) {
    case "client_confirmation": {
      const body = layout({
        heading: "Your consultation is confirmed.",
        intro: fill(t.confirmation.intro, ctx),
        rows: detailRows(ctx),
        cta: { label: "View or manage your booking", url: ctx.manageUrl },
        footer: [ctx.cancellationRules, "A calendar file is attached so you can add the appointment to your calendar.", DISCLAIMER],
        signature: email.signature,
      });
      return { subject: fill(t.confirmation.subject, ctx), ...body };
    }
    case "client_reminder": {
      const body = layout({
        heading: "See you soon.",
        intro: fill(t.reminder.intro, ctx),
        rows: detailRows(ctx),
        cta: { label: "Manage your booking", url: ctx.manageUrl },
        footer: [ctx.cancellationRules],
        signature: email.signature,
      });
      return { subject: fill(t.reminder.subject, ctx), ...body };
    }
    case "client_cancellation": {
      const body = layout({
        heading: "Your consultation has been cancelled.",
        intro: fill(t.cancellation.intro, ctx) + (ctx.refundNote ? `\n\n${ctx.refundNote}` : ""),
        rows: detailRows(ctx).filter(([k]) => k !== "Meeting link" && k !== "Meeting"),
        cta: { label: "Book a new time", url: ctx.manageUrl.replace(/\/booking\/.*/, "/book") },
        footer: [],
        signature: email.signature,
      });
      return { subject: fill(t.cancellation.subject, ctx), ...body };
    }
    case "client_reschedule": {
      const body = layout({
        heading: "Your consultation has moved.",
        intro: fill(t.reschedule.intro, ctx),
        rows: detailRows(ctx),
        cta: { label: "View or manage your booking", url: ctx.manageUrl },
        footer: [ctx.cancellationRules, "An updated calendar file is attached."],
        signature: email.signature,
      });
      return { subject: fill(t.reschedule.subject, ctx), ...body };
    }
    case "client_payment_issue": {
      const body = layout({
        heading: "Your booking wasn't completed.",
        intro: fill(t.paymentIssue.intro, ctx) + (ctx.extra ? `\n\n${ctx.extra}` : ""),
        rows: detailRows(ctx).filter(([k]) => k !== "Meeting link" && k !== "Meeting"),
        cta: { label: "Choose a time again", url: ctx.manageUrl.replace(/\/booking\/.*/, "/book") },
        footer: [],
        signature: email.signature,
      });
      return { subject: fill(t.paymentIssue.subject, ctx), ...body };
    }
    case "admin_new_booking":
    case "admin_cancellation":
    case "admin_reschedule": {
      const heading = { admin_new_booking: "New booking", admin_cancellation: "Booking cancelled", admin_reschedule: "Booking rescheduled" }[name];
      const body = layout({
        heading: `${heading}: ${ctx.clientName}`,
        intro: `${ctx.typeName} · ${formatTimeRange(ctx.start, ctx.end, ctx.businessTimeZone)} (${zoneLabel(ctx.businessTimeZone, ctx.start)})${ctx.extra ? `\n${ctx.extra}` : ""}`,
        rows: detailRows({ ...ctx, clientTimeZone: ctx.businessTimeZone }, true),
        cta: ctx.adminUrl ? { label: "Open in dashboard", url: ctx.adminUrl } : undefined,
        footer: [],
        signature: "Website booking system",
      });
      return { subject: `${heading}: ${ctx.typeName}, ${formatTimeRange(ctx.start, ctx.end, ctx.businessTimeZone)}`, ...body };
    }
  }
}

export function renderAdminAlert(subject: string, message: string, adminUrl?: string) {
  const body = layout({
    heading: subject,
    intro: message,
    rows: [],
    cta: adminUrl ? { label: "Open dashboard", url: adminUrl } : undefined,
    footer: [],
    signature: "Website booking system",
  });
  return { subject: `[Action needed] ${subject}`, ...body };
}
