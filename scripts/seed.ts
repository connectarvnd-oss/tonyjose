// Seeds initial content and configuration. Safe to run repeatedly: existing
// rows are never overwritten.
import "dotenv/config";
import { Client } from "pg";
import { defaultContent, defaultFaqs, defaultLegalPages, defaultServices } from "../src/lib/content-defaults";

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await db.connect();
  const count = async (table: string) => Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

  if ((await count("appointment_types")) === 0) {
    await db.query(
      `INSERT INTO appointment_types (slug, name, short_name, description, duration_minutes, price_cents, currency, one_per_client, calendar_label, cta_label, sort_order)
       VALUES
       ('free-enquiry', 'Free Initial Enquiry', 'Free enquiry',
        'Discuss your initial question, understand your needs, and determine suitable next steps.', 15, 0, 'EUR', true, 'Free', 'Book a Free Enquiry', 1),
       ('full-consultation', 'Full Consultation', 'Full consultation',
        'A more detailed discussion about visa support, overseas education, admissions, or migration-related questions.', 60, 2800, 'EUR', false, 'Paid', 'Book a Full Consultation', 2)`,
    );
    console.log("Seeded appointment types");
  }

  if ((await count("availability_rules")) === 0) {
    // Placeholder working hours (Mon–Fri, with a lunch break). Adjust in /admin/availability.
    for (let d = 1; d <= 5; d++) {
      await db.query(`INSERT INTO availability_rules (weekday, start_time, end_time) VALUES ($1,'09:00','12:30'), ($1,'13:30','17:30')`, [d]);
    }
    console.log("Seeded availability rules");
  }

  if ((await count("services")) === 0) {
    for (const [i, s] of defaultServices.entries()) {
      await db.query(`INSERT INTO services (title, description, sort_order) VALUES ($1,$2,$3)`, [s.title, s.description, i + 1]);
    }
    console.log("Seeded services");
  }

  if ((await count("faqs")) === 0) {
    for (const [i, f] of defaultFaqs.entries()) {
      await db.query(`INSERT INTO faqs (question, answer, sort_order) VALUES ($1,$2,$3)`, [f.question, f.answer, i + 1]);
    }
    console.log("Seeded FAQs");
  }

  for (const p of defaultLegalPages) {
    await db.query(`INSERT INTO legal_pages (slug, title, body_md) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`, [p.slug, p.title, p.bodyMd]);
  }

  for (const [key, value] of Object.entries(defaultContent)) {
    await db.query(`INSERT INTO site_content (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [key, JSON.stringify(value)]);
  }

  console.log("Seed complete.");
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
