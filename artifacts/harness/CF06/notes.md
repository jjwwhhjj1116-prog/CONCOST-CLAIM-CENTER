# CF06 Evidence Notes

- Core dashboard and CASE-01 through CASE-05 now use authenticated Cloudflare Worker APIs backed by the production D1 database.
- D1 stores cases, member assignments, parties, schedules, and append-only activity history.
- Case creation uses a browser-stable idempotency key, and status transitions use optimistic versions.
- The live dashboard was verified after deployment and returned the real empty D1 state rather than static preview values.
- No synthetic case was inserted into the production database during verification.
- Google Drive production OAuth is deliberately deferred by the user. R2 remains skipped.

## Deployment verification

- GitHub implementation commit: `3aa4396fcc526771209735393f7c021be947ab0d`
- Cloudflare build: `22b71a98-b572-40f0-82c7-931c5a0ed34a`
- Production URL: `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev/dashboard`
- Visible production marker: `D1 로그인·사건·초안 저장 활성`
- Production D1 verification: 6 case tables, 5 case triggers, migration ledger row present.
