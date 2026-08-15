import "dotenv/config";

/**
 * Loads .env so integration tests can reach the database.
 *
 * Unit tests do not need it; when DATABASE_URL is absent the integration
 * suites skip themselves rather than fail, so `npm test` works on a machine
 * with no database.
 */
