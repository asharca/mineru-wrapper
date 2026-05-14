import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

// Re-implement runMigration for unit testing (does not use the global db module)
function createTestDb() {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

function runMigration(db: Database, name: string, sql: string) {
  const exists = db.prepare("SELECT 1 FROM migrations WHERE name = ?").get(name);
  if (exists) return;
  db.transaction(() => {
    db.exec(sql);
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(name);
  })();
}

describe("runMigration", () => {
  it("applies a migration once", () => {
    const db = createTestDb();
    runMigration(db, "create_foo", "CREATE TABLE foo (id INTEGER PRIMARY KEY)");
    const rows = db.prepare("SELECT name FROM migrations").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { name: string }).name).toBe("create_foo");
  });

  it("is idempotent — does not re-run a migration that already ran", () => {
    const db = createTestDb();
    runMigration(db, "create_foo", "CREATE TABLE foo (id INTEGER PRIMARY KEY)");
    // Second call must not throw even though CREATE TABLE would fail if executed
    expect(() =>
      runMigration(db, "create_foo", "CREATE TABLE foo (id INTEGER PRIMARY KEY)"),
    ).not.toThrow();
  });

  it("records each migration separately", () => {
    const db = createTestDb();
    runMigration(db, "m1", "CREATE TABLE a (id INTEGER PRIMARY KEY)");
    runMigration(db, "m2", "CREATE TABLE b (id INTEGER PRIMARY KEY)");
    const names = (
      db.prepare("SELECT name FROM migrations ORDER BY id").all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual(["m1", "m2"]);
  });
});
