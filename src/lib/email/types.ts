export type EmailMessage = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string; contentType: string }[];
  idempotencyKey: string;
};

export interface Mailer {
  id: "resend" | "smtp" | "console";
  live: boolean;
  send(msg: EmailMessage): Promise<{ id: string }>;
}
