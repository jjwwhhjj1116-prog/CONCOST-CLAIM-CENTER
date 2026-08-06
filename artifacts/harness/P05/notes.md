# P05 Case Management Core Implementation Notes

## 1. Summary of Changes

- **Prisma Schema & SQLite Migration**:
  - Expanded `CaseItem` model with `caseNumber` (unique), `description`, `status` (default REGISTERED), `assignedUserId`.
  - Added `Party` model for case parties (supports 0, 1, 10+ parties with duplicate names resolved by ID).
  - Added `Schedule` model for case schedules (supports `COURT`, `CLIENT`, `INTERNAL` with Asia/Seoul D-day calculation).
  - Added `StatusHistory` model for append-only status transition logs.
  - Enforced DB constraints: `claimType IN ('TYPE-01'..'TYPE-06')` and `Schedule.type IN ('COURT','CLIENT','INTERNAL')`.
  - Generated P05 migration SQL (`20260806080000_p05_case_management/migration.sql`) applied dynamically by `db-engine.ts`.

- **API & Backend Logic (`apps/api/src/server.ts`)**:
  - `GET /api/cases`: Search by title, caseNumber, party name; filtered by tenant organization & user assignments.
  - `POST /api/cases`: Case creation restricted strictly to 6 claim types (`TYPE-01` to `TYPE-06`), rejecting `TYPE-07`.
  - `POST /api/cases/:id/status`: Enforced valid status transitions (`REGISTERED` -> `IN_PROGRESS` -> `REVIEWING` etc.).
  - Parties & Schedules APIs with IDOR validation across organization boundaries.
  - `GET /api/dashboard/kpi`: Calculates KPI metrics using exact DB query criteria matching case list filters.
  - Asia/Seoul KST midnight D-day calculation (`D-0`, `D-1`, `D+1`, leap day 2028-02-29).
  - Prisma transactional atomicity: Mutating operations & AuditLog records wrapped in single interactive transactions.

- **Test Suite Expansion**:
  - Added `scripts/p05-case-test.ts` covering CRUD, 6 claim types, 0/1/10 parties, 0/1/100 schedules, D-day edge cases, status transitions, optimistic locking (409), soft-delete (404), IDOR (403), and KPI consistency.
  - Extended `scripts/harness-test.ts` to run all 39 contracts (0 failed).
  - Verified P04 security suite (9/9 passed) and Playwright browser E2E.

## 2. 11 Quality & Security Gates Verification

All 11 gates passed cleanly:
1. `install`: PASS
2. `db:reset`: PASS
3. `db:migrate`: PASS
4. `db:seed`: PASS
5. `lint`: PASS (0 warnings)
6. `typecheck`: PASS (0 errors)
7. `test`: PASS (39/39 passed)
8. `build`: PASS
9. `test:e2e`: PASS (Playwright real Chromium)
10. `test:security`: PASS (9/9 passed)
11. `audit`: PASS (0 vulnerabilities)
