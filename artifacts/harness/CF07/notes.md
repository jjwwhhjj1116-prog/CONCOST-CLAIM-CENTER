# CF07 Evidence Notes

- The live Report Studio now stores one active D1 draft per case and appends an immutable revision for every accepted save.
- Drafts load by authenticated case assignment, auto-save after 900 ms, save on demand, and use optimistic versions to reject stale tabs.
- Reviewer accounts are read-only; editors are limited to Admin, CEO, Director, PM, and Staff.
- D1 triggers protect draft identity/version and revision update/delete invariants.
- The production URL was verified after deployment. With no production cases present, the honest empty state directs the user to register the first real case.
- No synthetic case or report content was inserted into the production database during verification.
- Google Drive production OAuth remains deliberately deferred by the user. R2 remains skipped.

## Deployment verification

- GitHub implementation commit: `547e782eda0d21f2e174a1e96df9de26df72c3d9`
- Cloudflare build: `7cd934ca`
- Production URL: `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev/reports/studio`
- Visible production marker: `D1 로그인·사건·초안 저장 활성`
- Production UI verification: `보고서를 연결할 사건이 없습니다` and `새 사건 등록` rendered from the deployed CF07 bundle.
- Production D1 verification: 2 report tables, 5 report triggers, migration ledger row present.
