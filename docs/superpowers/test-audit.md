# Phase 2 Test Audit Report

**Date:** 2026-06-08
**Scope:** Backend API integration tests under `packages/server/src/*.test.ts`
**Purpose:** Map current coverage against the BL-1…BL-13 black-list scenarios from spec §5.3, identify gaps, and inform the implementation plan in `docs/superpowers/plans/2026-06-08-phase-2-api-testing.md`.

## Test Files Surveyed

| File | LoC | Describe | Tests |
|---|---|---|---|
| `auth.test.ts` | 138 | Auth & Data Isolation | 7 |
| `apikeys.test.ts` | 228 | API Keys | 16 |
| `tasks.test.ts` | ~480 | Upload & Tasks API | ~30 |
| `settings.test.ts` | ~115 | User Settings | 10 |
| `db.test.ts` | ~150 | runMigration / FTS5 | pure unit |
| `mineru.test.ts` | ~30 | applyImageUrls | pure unit |

## Black-list Coverage Matrix

| BL | Description | Coverage | Gap |
|---|---|---|---|
| BL-1 | Unauthenticated → 401 | `/upload`, `/tasks`, `/api/api-keys` GET/POST/DELETE, `/api/settings` GET/PUT | `/api/parse`, `/api/parse/sync`, `/tasks/batch-delete`, `/tasks/{id}/reprocess`, `PATCH /tasks/{id}`, `/files/{filename}`, `/files/img/{filename}` |
| BL-2 | Cross-user → 404 | `GET /tasks/{id}`, `DELETE /tasks/{id}`, `DELETE /api/api-keys/{id}` | `PATCH /tasks/{id}`, `POST /tasks/{id}/reprocess`, `GET /files/{filename}` |
| BL-3 | Wrong API key → 401 | `/tasks` only (apikeys.test.ts) | `/api/parse`, `/api/parse/sync` |
| BL-4 | Revoked key immediately rejected | none | needs dedicated test |
| BL-5 | Bad MIME → 400 | `/upload` | `/api/parse`, `/api/parse/sync` |
| BL-6 | Over size limit → 413 | n/a — product gap | filed separately |
| BL-7 | Missing file field → 400 | all 3 endpoints | — |
| BL-8 | GET /tasks/{bad-uuid} → 404/400 | non-existent UUID-shape returns 404 | malformed (non-UUID) ID returns 400 via Zod validation |
| BL-9 | Delete nonexistent → 404 | covered | — |
| BL-10 | Error response shape consistency | implicit `{ error: string }` everywhere | dedicated assertion sweep deferred — low risk |
| BL-11 | mineru upstream 500 → task `failed` | none | needs isolated test with closed-port MINERU_URL |
| BL-12 | Duplicate email registration → error | none | better-auth handles it; needs explicit test |
| BL-13 | Logged-out cookie → 401 | none | needs sign-out test |

## Known Product Gaps (Flagged During Audit)

- **BL-6 — no upload size limit.** `routes/upload.ts` does not enforce a max byte length on the multipart `file` field. Recommended follow-up: add a config-driven limit (`MAX_UPLOAD_BYTES`, default 50 MB), reject with 413. Track separately from Phase 2.
- **`GET /files/:filename` falls back to `user_id IS NULL`.** SQL: `WHERE filename = ? AND (user_id = ? OR user_id IS NULL)`. Legacy data without an owner is accessible to any authenticated user. Verify whether any rows with `user_id IS NULL` still exist; if not, tighten the predicate.

## Out of Scope for Phase 2

- Frontend integration tests (Phase 3 may add)
- Playwright E2E (deliberately deferred per spec §5)
- Refactoring existing tests for DRY — current per-file `registerAndLogin` duplication is acceptable
