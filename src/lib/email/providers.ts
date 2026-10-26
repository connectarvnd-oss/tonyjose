import nodemailer from "nodemailer";
import type { EmailMessage, Mailer } from "./types";

export class ResendMailer implements Mailer {
  id = "resend" as const;
  live = true;
  constructor(private apiKey: string) {}

  async send(msg: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": msg.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: msg.from,
        to: [msg.to],
        reply_to: msg.replyTo || undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString("base64"),
          content_type: a.contentType,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) throw new Error(`Resend error ${res.status}: ${body.message ?? "unknown"}`);
    return { id: body.id };
  }
}

/** Sends through any SMTP server, e.g. Gmail with an app password (smtp.gmail.com:465). */
export class SmtpMailer implements Mailer {
  id = "smtp" as const;
  live = true;
  private transport: nodemailer.Transporter;
  constructor(opts: { host: string; port: number; user: string; password: string }) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.port === 465,
      auth: { user: opts.user, pass: opts.password },
    });
  }

  async send(msg: EmailMessage) {
    const info = await this.transport.sendMail({
      from: msg.from,
      to: msg.to,
      replyTo: msg.replyTo || undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    return { id: info.messageId };
  }
}

/** Development mailer: prints emails to the server log. NOT a real delivery. */
export class ConsoleMailer implements Mailer {
  id = "console" as const;
  live = false;
  sent: EmailMessage[] = [];

  async send(msg: EmailMessage) {
    this.sent.push(msg);
    if (process.env.NODE_ENV !== "test") {
      console.info(`\n[email:console] NOT SENT (no email provider configured)\n  to: ${msg.to}\n  subject: ${msg.subject}\n${msg.text}\n`);
    }
    return { id: `console_${Date.now()}_${this.sent.length}` };
  }
}
