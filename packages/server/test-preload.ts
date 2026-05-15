import { rmSync, statSync } from "node:fs";

// This preload runs before each test file in its own Bun worker.
// All workers share process.env and module cache, so every test file
// MUST use the same DB path. We only delete the DB file on the *first*
// preload of a test run — identified by the file being older than 3 s.
// Subsequent preloads within the same run see a freshly-created file
// and leave it alone, preventing mid-run DB teardown.
const TEST_DB = "./data/test-all.db";
const TEST_UPLOADS = "./uploads-test";

process.env.DB_PATH = TEST_DB;
process.env.UPLOAD_DIR = TEST_UPLOADS;

try {
  const { mtimeMs } = statSync(TEST_DB);
  const ageMs = Date.now() - mtimeMs;
  if (ageMs > 3000) {
    rmSync(TEST_DB);
    try { rmSync(`${TEST_DB}-wal`); } catch { /* ignore */ }
    try { rmSync(`${TEST_DB}-shm`); } catch { /* ignore */ }
    try { rmSync(TEST_UPLOADS, { recursive: true, force: true }); } catch { /* ignore */ }
  }
} catch {
  // DB doesn't exist yet — nothing to delete
}
