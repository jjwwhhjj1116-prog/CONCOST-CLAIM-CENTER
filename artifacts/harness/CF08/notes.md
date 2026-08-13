# CF08 Evidence Notes

- A saved D1 report revision can now be submitted to an authenticated, assignment-scoped review queue.
- Each request is bound to an immutable report revision and optimistic report version.
- Request replay uses an idempotency key. A reused key with different content returns a conflict.
- Admin, CEO, Director, and Reviewer may decide an assigned request; the requester cannot decide their own request.
- Approval of a report changed after submission is rejected. A reviewer can close that stale request as changes requested so the author can submit the newer revision.
- Requests, decisions, and review events are protected by D1 scope, identity, independence, role, assignment, and append-only triggers.
- The deployed APPR-01 route was verified with the existing authenticated PM session. It rendered the real D1 queue, filters, self-approval notice, and honest zero-request state with zero browser console errors.
- No synthetic case, report, review, or decision was inserted into production during verification.
- Google Drive production OAuth remains deferred by the user. R2 remains skipped. DOCX/PDF final output remains CF09.

## Deployment verification

- GitHub implementation commit: `84ffd86cc548724818e70cf75f09ce19ff72ddc9`
- Cloudflare build: `0d8670bf-0b8f-4978-b31b-66db171aa2f7`
- Worker version: `4ee7a9f1-4535-4298-ad04-18b870a11759`
- Production URL: `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev/approval`
- Production D1 verification: 2 review tables, 7 review triggers, migration ledger row present.
