export type GoogleAdapterMode =
  | 'SUCCESS'
  | 'DUPLICATE_REPLAY'
  | 'BAD_SCOPE'
  | 'TOKEN_EXPIRED'
  | 'RECONSENT_REQUIRED'
  | 'RATE_LIMIT_RETRY_AFTER'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'USER_CANCEL'
  | 'MALFORMED_PROVIDER_RESPONSE'
  | 'REVOKE_FAILURE';

export interface GoogleWorkspaceConnectionInfo {
  organizationId: string;
  status: 'CONNECTED' | 'EXPIRED' | 'RECONSENT_REQUIRED' | 'DISCONNECTED';
  grantedScopes: string[];
  secretRef: string;
  tokenExpiresAt: Date | null;
}

export interface DriveFolderResult {
  folderId: string;
  folderName: string;
  webViewLink: string;
  isExisting: boolean;
}

export interface GmailAttachmentItem {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
}

export interface GmailImportResult {
  importedCount: number;
  items: Array<{
    attachmentId: string;
    documentId: string;
    filename: string;
    sha256: string;
  }>;
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  startDateTime: string;
  endDateTime: string;
  humanConfirmed: boolean;
  sourceParagraphText?: string;
}

export interface CalendarEventResult {
  eventId: string;
  htmlLink: string;
  summary: string;
}

export interface DocsExportResult {
  documentId: string;
  title: string;
  webViewLink: string;
  version: number;
}

export interface SheetsImportInput {
  spreadsheetId: string;
  sheetName: string;
  rangeA1: string;
}

export interface SheetsImportResult {
  snapshotId: string;
  rowCount: number;
  columnCount: number;
  sha256: string;
  valuesJson: string;
}

export interface GoogleAdapterResponse<T> {
  responseClass: GoogleAdapterMode;
  data?: T;
  redactedError?: string;
  retryAfterSeconds?: number;
  durationMs: number;
}

export interface GoogleWorkspaceAdapter {
  testConnection(connection: GoogleWorkspaceConnectionInfo): Promise<GoogleAdapterResponse<{ ok: boolean }>>;
  createDriveFolder(caseId: string, caseTitle: string, idempotencyKey?: string): Promise<GoogleAdapterResponse<DriveFolderResult>>;
  importGmailAttachments(caseId: string, selectedAttachmentIds: string[]): Promise<GoogleAdapterResponse<GmailImportResult>>;
  createCalendarEvent(caseId: string, input: CalendarEventInput): Promise<GoogleAdapterResponse<CalendarEventResult>>;
  exportDocs(caseId: string, meetingId: string, versionNumber: number, title: string, content: string): Promise<GoogleAdapterResponse<DocsExportResult>>;
  importSheets(caseId: string, input: SheetsImportInput): Promise<GoogleAdapterResponse<SheetsImportResult>>;
  revokeConnection(secretRef: string): Promise<GoogleAdapterResponse<{ revoked: boolean }>>;
}

export const REQUIRED_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets.readonly'
] as const;

export const ALLOWED_REDIRECT_DOMAINS = new Set([
  'localhost',
  '127.0.0.1',
  'claim-center.invalid'
]);
