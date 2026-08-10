# P12 Harness Implementation Notes

## Key Specifications Implemented

1. **Section Approval API Reuse**:
   - Reused existing P09 `POST /api/reports/:id/sections/:sectionId/approve` endpoint without duplicating approval logic or breaking RBAC guards.
   - Enforced reviewer role checks (`admin`, `director`, `reviewer`) and prevents self-approval.

2. **Node 24 + pnpm@9.15.0 + tsx Pipeline Compatibility**:
   - Ensured clean script execution with `cmd /c npx --package=pnpm@9.15.0 pnpm <script>` under Node 24.16.0 environment.

3. **Report Finalization & Immutable Fixation**:
   - Implemented `POST /api/reports/:id/finalizations` with 8 strict readiness checks.
   - Fixed latest approved revision ID, revision number, title, sha256, and section order into immutable `ReportFinalization` and `ReportFinalizationSection` entities in DB.

4. **Multi-Page DOCX/PDF Generation (100 Sections Support)**:
   - Enhanced `packages/document-engine` to render complete multi-section documents (supporting 100+ sections) with fixed DOS zip entry timestamps for DOCX and fixed `/CreationDate` & `/ModDate` for PDF.

5. **Independent OOXML & PDF Parsers**:
   - Built standalone XML/ZIP parser (`validateReportDocxBuffer`) and xref/stream PDF parser (`validateReportPdfBuffer`) inside `packages/document-engine`.

6. **Byte-Level Hash Determinism**:
   - Verified that re-rendering from the same snapshot produces byte-for-byte identical SHA-256 binary outputs.

7. **Transactional DB & File System Safety**:
   - Enforced file write rollback if DB transaction or AuditLog creation fails, preventing orphaned files on disk.

8. **Chromium E2E Automation**:
   - Automated real browser workflow: Staff login -> Submit review request -> Reviewer login -> Approve sections -> Finalize snapshot -> Generate DOCX/PDF -> Download & Validate binary contents.
