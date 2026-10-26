// Tests run against a real PostgreSQL database (TEST_DATABASE_URL) so the
// exclusion constraint and transactions are exercised for real.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://tony:tony@localhost:5432/tony_test";
process.env.APP_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = "http://localhost:3000";
process.env.ADMIN_NOTIFICATION_EMAIL = "tony@example.com";
