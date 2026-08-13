# CF09 Codex Handoff — Approved Final Output

## Objective

Turn one independently approved D1 report revision into an immutable finalization and downloadable DOCX/PDF outputs without enabling deferred R2 or Google Drive storage.

## Implemented scope

1. `preview_report_finalizations` binds the final state to the exact approved review, revision, and version.
2. `preview_report_outputs` records deterministic file name, byte size, and SHA-256 for DOCX/PDF.
3. `preview_report_output_events` preserves finalization, generation, and download activity.
4. D1 guards reject non-current/unapproved sources, unauthorized finalizers, and update/delete tampering.
5. A Workers-compatible deterministic DOCX ZIP and Korean-capable PDF engine regenerates bytes from the immutable revision.
6. Downloads verify byte size and SHA-256 against D1 before returning the file.
7. Report Studio exposes finalization, DOCX/PDF generation, hashes, sizes, and downloads only after independent approval.

## Storage decision

- File bytes are not stored in R2. R2 remains `SKIPPED_BY_USER`.
- Output bytes are regenerated deterministically from the immutable D1 snapshot on every download.
- Google Drive remains `DEFERRED_BY_USER` and is not required for report editing or final output.

## Gate contract

- CF09 focused tests: exact approval binding, idempotent finalization, role denial, deterministic binary output, restart persistence, raw D1 tamper rejection, and production UI actions.
- Cloudflare regression, full repository regression, lint, typecheck, production build, remote D1 migration, live Worker deployment, and browser verification are mandatory before review.
