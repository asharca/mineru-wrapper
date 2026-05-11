import type { AuthSession, AuthUser } from "../auth.ts";

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
    session: AuthSession;
  }
}

export { authMiddleware } from "./auth.ts";
