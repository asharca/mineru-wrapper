import Database from "bun:sqlite";
import { betterAuth } from "better-auth";

const db = new Database(process.env.DB_PATH || "./data/ocr.db");

export const auth = betterAuth({
  database: db,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  advanced: {
    cookiePrefix: "better-auth",
  },
  secret: process.env.BETTER_AUTH_SECRET || "test-secret-change-me-in-production",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3002",
});

// Initialize context and run migrations
const ctx = await auth.$context;
await ctx.runMigrations();

export type AuthUser = typeof auth.$Infer.Session.user;
export type AuthSession = typeof auth.$Infer.Session.session;
