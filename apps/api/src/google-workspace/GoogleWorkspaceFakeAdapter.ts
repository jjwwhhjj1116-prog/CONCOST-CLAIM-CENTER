import * as crypto from 'node:crypto';
import type {
  GoogleWorkspaceAdapter,
  GoogleAdapterMode,
  GoogleAdapterResponse,
  GoogleWorkspaceConnectionInfo,
  DriveFolderResult,
  GmailImportResult,
  GmailAttachmentCandidate,
  CalendarEventInput,
  CalendarEventResult,
  DocsExportResult,
  SheetsImportInput,
  SheetsImportResult,
  SheetSourceCandidate
} from './GoogleWorkspaceAdapter';

const FAKE_GMAIL_CONTENT = new Map<string, { filename: string; mimeType: string; content: Buffer }>([
  ['gmail-att-001', { filename: '현장사진_설명.txt', mimeType: 'text/plain', content: Buffer.from('SYNTHETIC Gmail attachment 001 for claim evidence.\n', 'utf8') }],
  ['gmail-att-002', { filename: '공사비_검토자료.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF-1.4\n% SYNTHETIC GOOGLE ATTACHMENT 002\n%%EOF\n', 'utf8') }],
  ['gmail-att-003', { filename: '계약조건_발췌.txt', mimeType: 'text/plain', content: Buffer.from('SYNTHETIC Gmail attachment 003 contract excerpt.\n', 'utf8') }]
]);

export const FAKE_SHEET_SOURCES: SheetSourceCandidate[] = [
  { spreadsheetId: 'sheet-source-001', sheetName: '비용산정', allowedRange: 'A1:C200', displayName: 'SYNTHETIC 비용산정 시트' },
  { spreadsheetId: 'sheet-source-002', sheetName: '물량내역', allowedRange: 'A1:F100', displayName: 'SYNTHETIC 물량내역 시트' }
];

function caseSourceToken(caseId: string): string {
  return crypto.createHash('sha256').update(caseId).digest('hex').slice(0, 12);
}

export class GoogleWorkspaceFakeAdapter implements GoogleWorkspaceAdapter {
  private mode: GoogleAdapterMode = 'SUCCESS';

  constructor(initialMode: GoogleAdapterMode = 'SUCCESS') {
    this.mode = initialMode;
  }

  public setMode(mode: GoogleAdapterMode): void {
    this.mode = mode;
  }

  public getMode(): GoogleAdapterMode {
    return this.mode;
  }

  public createAuthorizationUrl(input: { state: string; codeChallenge: string; scopes: readonly string[] }): string {
    const query = new URLSearchParams({
      response_type: 'code',
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      scope: input.scopes.join(' ')
    });
    return `https://accounts.google.invalid/o/oauth2/v2/auth?${query.toString()}`;
  }

  private simulate<T>(fn: () => T, customMode?: GoogleAdapterMode): GoogleAdapterResponse<T> {
    const activeMode = customMode ?? this.mode;
    const start = Date.now();

    switch (activeMode) {
      case 'SUCCESS':
      case 'DUPLICATE_REPLAY':
        return {
          responseClass: activeMode,
          data: fn(),
          durationMs: Date.now() - start
        };
      case 'BAD_SCOPE':
        return {
          responseClass: 'BAD_SCOPE',
          redactedError: 'Provider error: Insufficient OAuth scope (HTTP 403 insufficientPermissions)',
          durationMs: Date.now() - start
        };
      case 'TOKEN_EXPIRED':
        return {
          responseClass: 'TOKEN_EXPIRED',
          redactedError: 'Provider error: OAuth access token has expired (HTTP 401 Invalid Credentials)',
          durationMs: Date.now() - start
        };
      case 'RECONSENT_REQUIRED':
        return {
          responseClass: 'RECONSENT_REQUIRED',
          redactedError: 'Provider error: User re-consent required for requested scope (HTTP 403 invalid_grant)',
          durationMs: Date.now() - start
        };
      case 'RATE_LIMIT_RETRY_AFTER':
        return {
          responseClass: 'RATE_LIMIT_RETRY_AFTER',
          redactedError: 'Provider error: Rate limit exceeded. Retry after 5 seconds (HTTP 429 Too Many Requests)',
          retryAfterSeconds: 5,
          durationMs: Date.now() - start
        };
      case 'SERVER_ERROR':
        return {
          responseClass: 'SERVER_ERROR',
          redactedError: 'Provider error: Backend internal server error (HTTP 500 Internal Server Error)',
          durationMs: Date.now() - start
        };
      case 'TIMEOUT':
        return {
          responseClass: 'TIMEOUT',
          redactedError: 'Provider error: Request connection timed out (HTTP 504 Gateway Timeout)',
          durationMs: Date.now() - start
        };
      case 'USER_CANCEL':
        return {
          responseClass: 'USER_CANCEL',
          redactedError: 'User cancelled provider OAuth consent flow',
          durationMs: Date.now() - start
        };
      case 'MALFORMED_PROVIDER_RESPONSE':
        return {
          responseClass: 'MALFORMED_PROVIDER_RESPONSE',
          redactedError: 'Provider error: Malformed JSON response body from provider',
          durationMs: Date.now() - start
        };
      case 'REVOKE_FAILURE':
        return {
          responseClass: 'REVOKE_FAILURE',
          redactedError: 'Provider error: Failed to revoke token on provider server (HTTP 502 Bad Gateway)',
          durationMs: Date.now() - start
        };
      default:
        return {
          responseClass: 'SUCCESS',
          data: fn(),
          durationMs: Date.now() - start
        };
    }
  }

  public async exchangeAuthorizationCode(code: string, pkceVerifier: string): Promise<GoogleAdapterResponse<{ grantedScopes: string[]; secretRef: string; expiresInSeconds: number }>> {
    if (code !== 'FAKE_AUTHORIZATION_CODE' || !/^[A-Za-z0-9._~-]{43,128}$/.test(pkceVerifier)) {
      return {
        responseClass: 'MALFORMED_PROVIDER_RESPONSE',
        redactedError: 'OAuth authorization response or PKCE verifier is invalid',
        durationMs: 0
      };
    }
    return this.simulate(() => ({
      grantedScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/spreadsheets.readonly'
      ],
      secretRef: 'LOCAL_FAKE_GOOGLE',
      expiresInSeconds: 3600
    }));
  }

  public async testConnection(connection: GoogleWorkspaceConnectionInfo): Promise<GoogleAdapterResponse<{ ok: boolean }>> {
    if (connection.status === 'EXPIRED') return this.simulate(() => ({ ok: false }), 'TOKEN_EXPIRED');
    if (connection.status === 'RECONSENT_REQUIRED') return this.simulate(() => ({ ok: false }), 'RECONSENT_REQUIRED');
    if (connection.status === 'DISCONNECTED') return this.simulate(() => ({ ok: false }), 'BAD_SCOPE');
    return this.simulate(() => ({ ok: true }));
  }

  public async listGmailAttachments(caseId: string): Promise<GoogleAdapterResponse<GmailAttachmentCandidate[]>> {
    const prefix = `${caseSourceToken(caseId)}:`;
    return this.simulate(() => Array.from(FAKE_GMAIL_CONTENT.entries()).map(([attachmentId, item]) => ({
      attachmentId: `${prefix}${attachmentId}`,
      filename: item.filename,
      mimeType: item.mimeType,
      sizeBytes: item.content.length
    })));
  }

  public async listSheetSources(caseId: string): Promise<GoogleAdapterResponse<SheetSourceCandidate[]>> {
    const suffix = caseSourceToken(caseId);
    return this.simulate(() => FAKE_SHEET_SOURCES.map((source) => ({ ...source, spreadsheetId: `${source.spreadsheetId}-${suffix}` })));
  }

  public async createDriveFolder(caseId: string, caseTitle: string, _idempotencyKey?: string): Promise<GoogleAdapterResponse<DriveFolderResult>> {
    return this.simulate(() => {
      const folderHash = crypto.createHash('sha256').update(caseId).digest('hex').substring(0, 16);
      return {
        folderId: `drive-folder-${folderHash}`,
        folderName: `[사건] ${caseTitle}`,
        webViewLink: `https://drive.google.invalid/drive/folders/drive-folder-${folderHash}`,
        isExisting: false
      };
    });
  }

  public async importGmailAttachments(caseId: string, selectedAttachmentIds: string[]): Promise<GoogleAdapterResponse<GmailImportResult>> {
    return this.simulate(() => {
      const prefix = `${caseSourceToken(caseId)}:`;
      const items = selectedAttachmentIds.map((attId) => {
        if (!attId.startsWith(prefix)) throw new Error('Cross-case Gmail attachment selection');
        const candidate = FAKE_GMAIL_CONTENT.get(attId.slice(prefix.length));
        if (!candidate) throw new Error('Unselected or unknown Gmail attachment');
        const sha256 = crypto.createHash('sha256').update(candidate.content).digest('hex');
        return {
          attachmentId: attId,
          documentId: `DOC-GMAIL-${crypto.createHash('sha256').update(`${caseId}:${attId}`).digest('hex').substring(0, 16)}`,
          filename: candidate.filename,
          mimeType: candidate.mimeType,
          sizeBytes: candidate.content.length,
          contentBase64: candidate.content.toString('base64'),
          sha256
        };
      });
      return {
        importedCount: items.length,
        items
      };
    });
  }

  public async createCalendarEvent(caseId: string, input: CalendarEventInput, idempotencyKey: string): Promise<GoogleAdapterResponse<CalendarEventResult>> {
    if (!input.humanConfirmed) {
      return {
        responseClass: 'MALFORMED_PROVIDER_RESPONSE',
        redactedError: 'Human confirmation is strictly required before creating Google Calendar event',
        durationMs: 5
      };
    }
    return this.simulate(() => {
      const eventHash = crypto.createHash('sha256').update(`${caseId}:${idempotencyKey}:${input.summary}:${input.startDateTime}`).digest('hex').substring(0, 16);
      return {
        eventId: `cal-evt-${eventHash}`,
        htmlLink: `https://calendar.google.invalid/event?eid=${eventHash}`,
        summary: input.summary
      };
    });
  }

  public async exportDocs(caseId: string, meetingId: string, versionNumber: number, title: string, content: string, idempotencyKey: string): Promise<GoogleAdapterResponse<DocsExportResult>> {
    return this.simulate(() => {
      const docHash = crypto.createHash('sha256').update(`${caseId}:${meetingId}:${versionNumber}:${idempotencyKey}:${content}`).digest('hex').substring(0, 16);
      return {
        documentId: `gdoc-${docHash}`,
        title: title || `[회의록 v${versionNumber}] ${meetingId}`,
        webViewLink: `https://docs.google.invalid/document/d/gdoc-${docHash}`,
        version: versionNumber
      };
    });
  }

  public async importSheets(caseId: string, input: SheetsImportInput): Promise<GoogleAdapterResponse<SheetsImportResult>> {
    return this.simulate(() => {
      const sampleData = JSON.stringify({
        spreadsheetId: input.spreadsheetId,
        sheetName: input.sheetName,
        range: input.rangeA1,
        headers: ['항목', '금액(원)', '비고'],
        rows: [
          ['인건비', 50000000, '정상'],
          ['재료비', 120000000, '확인필요']
        ]
      });
      const sha256 = crypto.createHash('sha256').update(sampleData).digest('hex');
      return {
        snapshotId: `sheet-snap-${crypto.randomUUID()}`,
        rowCount: 2,
        columnCount: 3,
        sha256,
        valuesJson: sampleData
      };
    });
  }

  public async revokeConnection(_secretRef: string): Promise<GoogleAdapterResponse<{ revoked: boolean }>> {
    if (this.mode === 'REVOKE_FAILURE') {
      return this.simulate(() => ({ revoked: false }), 'REVOKE_FAILURE');
    }
    return this.simulate(() => ({ revoked: true }));
  }
}
