# CF09 Evidence Notes

- Implementation commit: `5989d77f5675fd4c4ff183c7a906036bbb308db1`
- Scope: immutable approved finalization and deterministic Worker DOCX/PDF output.
- R2: skipped by user; no binding or payment enrollment added.
- Google Drive: deferred by user; no OAuth configuration required.
- Local gates: lint PASS, typecheck PASS, build PASS, CF09 4/4 PASS, Cloudflare regression 39/39 PASS, full regression 136/136 PASS.
- D1 remote migration: `0008_cf09_final_output.sql` applied; 3 tables, 8 triggers, and one migration ledger row verified.
- Additive correction `0009_cf09_output_actor_scope.sql` applied; final ledger has two CF09 rows and the same eight active triggers.
- Cloudflare build `9d40e781-d5d6-4b86-b410-3382f04718f7` deployed Worker version `8602c335-c6ce-4dd7-8d16-f2b7f084e10a` with 4 ms startup.
- Final output bytes are regenerated and checked against D1 SHA-256/byte size before each download.
