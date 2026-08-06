import * as fs from 'node:fs';
import * as path from 'node:path';

const dataDir = path.join(__dirname, '../.data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const dbPath = path.join(dataDir, 'harness-db.json');

export interface DbState {
  Organization: Record<string, any>;
  User: Record<string, any>;
  Role: Record<string, any>;
  UserRole: Array<{ userId: string; roleId: string }>;
  Session: Record<string, any>;
  CaseItem: Record<string, any>;
  CaseAssignment: Array<{ caseId: string; userId: string }>;
  Report: Record<string, any>;
  ReportSection: Record<string, any>;
  AuditLog: Record<string, any>;
}

const emptyState = (): DbState => ({
  Organization: {},
  User: {},
  Role: {},
  UserRole: [],
  Session: {},
  CaseItem: {},
  CaseAssignment: [],
  Report: {},
  ReportSection: {},
  AuditLog: {}
});

declare global {
  var __HARNESS_DB_STATE__: DbState | undefined;
}

function loadDb(): DbState {
  if (globalThis.__HARNESS_DB_STATE__) {
    return globalThis.__HARNESS_DB_STATE__;
  }
  if (!fs.existsSync(dbPath)) {
    globalThis.__HARNESS_DB_STATE__ = emptyState();
    saveDb(globalThis.__HARNESS_DB_STATE__);
    return globalThis.__HARNESS_DB_STATE__;
  }
  try {
    globalThis.__HARNESS_DB_STATE__ = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    return globalThis.__HARNESS_DB_STATE__!;
  } catch {
    globalThis.__HARNESS_DB_STATE__ = emptyState();
    return globalThis.__HARNESS_DB_STATE__;
  }
}

function saveDb(state: DbState) {
  globalThis.__HARNESS_DB_STATE__ = state;
  fs.writeFileSync(dbPath, JSON.stringify(state, null, 2), 'utf8');
}

export class MemoryDbConnection {
  private get state(): DbState {
    return loadDb();
  }

  public prepare(sql: string) {
    const trimmed = sql.trim().replace(/\s+/g, ' ');

    return {
      run: (...params: any[]) => {
        const state = this.state;
        if (trimmed.startsWith('UPDATE AuditLog')) {
          throw new Error('AuditLog is append-only. UPDATE operations are forbidden by DB trigger.');
        }
        if (trimmed.startsWith('DELETE FROM AuditLog')) {
          throw new Error('AuditLog is append-only. DELETE operations are forbidden by DB trigger.');
        }

        if (trimmed.startsWith('INSERT OR REPLACE INTO Role')) {
          state.Role[params[0]] = { id: params[0], name: params[1] };
        }
        else if (trimmed.startsWith('INSERT OR REPLACE INTO Organization')) {
          state.Organization[params[0]] = { id: params[0], name: params[1], createdAt: params[2], updatedAt: params[3] };
        }
        else if (trimmed.startsWith('INSERT OR REPLACE INTO UserRole')) {
          state.UserRole = state.UserRole.filter(r => !(r.userId === params[0] && r.roleId === params[1]));
          state.UserRole.push({ userId: params[0], roleId: params[1] });
        }
        else if (trimmed.startsWith('INSERT OR REPLACE INTO User (')) {
          state.User[params[0]] = { id: params[0], email: params[1], passwordHash: params[2], name: params[3], organizationId: params[4], isActive: params[5], createdAt: params[6], updatedAt: params[7] };
        }
        else if (trimmed.startsWith('INSERT INTO Session') || trimmed.startsWith('INSERT OR REPLACE INTO Session')) {
          state.Session[params[0]] = { id: params[0], userId: params[1], tokenHash: params[2], expiresAt: params[3], revokedAt: params[4], createdAt: params[5] };
        } else if (trimmed.startsWith('UPDATE Session SET revokedAt')) {
          const sess = Object.values(state.Session).find((s: any) => s.tokenHash === params[1]);
          if (sess) sess.revokedAt = params[0];
        }
        else if (trimmed.startsWith('INSERT OR REPLACE INTO CaseItem')) {
          state.CaseItem[params[0]] = { id: params[0], organizationId: params[1], title: params[2], claimType: params[3], version: params[4], deletedAt: params[5], createdAt: params[6], updatedAt: params[7] };
        } else if (trimmed.startsWith('UPDATE CaseItem SET title = ?, version = ?, updatedAt = ? WHERE id = ? AND version = ?')) {
          const item = state.CaseItem[params[3]];
          if (item && item.version === params[4]) {
            item.title = params[0];
            item.version = params[1];
            item.updatedAt = params[2];
          }
        } else if (trimmed.startsWith('UPDATE CaseItem SET deletedAt = ?, updatedAt = ? WHERE id = ?')) {
          const item = state.CaseItem[params[2]];
          if (item) {
            item.deletedAt = params[0];
            item.updatedAt = params[1];
          }
        }
        else if (trimmed.startsWith('INSERT OR REPLACE INTO CaseAssignment')) {
          state.CaseAssignment.push({ caseId: params[0], userId: params[1] });
        }
        else if (trimmed.startsWith('INSERT OR REPLACE INTO ReportSection')) {
          state.ReportSection[params[0]] = { id: params[0], reportId: params[1], title: params[2], content: params[3], status: params[4], version: params[5], deletedAt: params[6], createdAt: params[7], updatedAt: params[8] };
        } else if (trimmed.startsWith('INSERT OR REPLACE INTO Report')) {
          state.Report[params[0]] = { id: params[0], caseId: params[1], title: params[2], version: params[3], deletedAt: params[4], createdAt: params[5], updatedAt: params[6] };
        }
        else if (trimmed.startsWith('INSERT INTO AuditLog')) {
          state.AuditLog[params[0]] = { id: params[0], organizationId: params[1], userId: params[2], action: params[3], targetEntity: params[4], targetId: params[5], metadataJson: params[6], createdAt: params[7] };
        }

        saveDb(state);
        return { changes: 1 };
      },
      get: (...params: any[]) => {
        const state = this.state;
        if (trimmed.includes('FROM Session s JOIN User u')) {
          const sess = Object.values(state.Session).find((s: any) => s.tokenHash === params[0]);
          if (!sess) return undefined;
          const u = state.User[sess.userId];
          return u ? { ...sess, organizationId: u.organizationId, isActive: u.isActive, name: u.name, email: u.email } : undefined;
        }
        if (trimmed.includes('FROM Role')) {
          return Object.values(state.Role);
        }
        if (trimmed.includes('FROM User')) {
          const userList = Object.values(state.User);
          const user = userList.find((u: any) => u.email === params[0]);
          if (user && user.passwordHash === params[1]) {
            return user;
          }
          return undefined;
        }
        if (trimmed.includes('FROM CaseItem WHERE id = ?')) {
          const item = state.CaseItem[params[0]];
          if (!item) return undefined;
          if (trimmed.includes('deletedAt IS NULL') && item.deletedAt) {
            return undefined;
          }
          return item;
        }
        if (trimmed.includes('FROM AuditLog LIMIT 1')) {
          return Object.values(state.AuditLog)[0];
        }
        return undefined;
      },
      all: (...params: any[]) => {
        const state = this.state;
        if (trimmed.includes('FROM Role')) {
          return Object.values(state.Role);
        }
        if (trimmed.includes('FROM UserRole WHERE userId = ?')) {
          return state.UserRole.filter(r => r.userId === params[0]);
        }
        if (trimmed.includes('FROM AuditLog')) {
          return Object.values(state.AuditLog).filter((a: any) => a.organizationId === params[0]);
        }
        return [];
      }
    };
  }

  public close() {}
}

export function getDbConnection() {
  return new MemoryDbConnection();
}

export function initDatabaseSchema() {
  loadDb();
}

export function resetDatabase() {
  globalThis.__HARNESS_DB_STATE__ = emptyState();
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  saveDb(globalThis.__HARNESS_DB_STATE__);
}
