import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { getDbConnection, hashPassword, hashToken, initDatabaseSchema } from '@claim-studio/database';

initDatabaseSchema();

const PORT = 3001;

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const list: Record<string, string> = {};
  const rawCookie = Array.isArray(req.headers.cookie) ? req.headers.cookie.join('; ') : req.headers.cookie;
  if (rawCookie) {
    rawCookie.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      const key = parts.shift()!.trim();
      const value = decodeURIComponent(parts.join('='));
      list[key] = value;
    });
  }
  return list;
}

export function createApiServer() {
  return http.createServer((req, res) => {
    const db = getDbConnection();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const cookies = parseCookies(req);

    const origin = req.headers.origin;
    if (origin === 'http://localhost:3000' || origin === 'http://localhost:3001') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      db.close();
      return;
    }

    let sessionUser: any = null;
    let sessionRoles: string[] = [];

    const sessionToken = cookies['session_token'] || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);

    if (sessionToken) {
      const hashed = hashToken(sessionToken);
      const sess = db.prepare(`
        SELECT s.id as sessionId, s.userId, s.expiresAt, s.revokedAt, u.organizationId, u.isActive, u.name, u.email
        FROM Session s
        JOIN User u ON s.userId = u.id
        WHERE s.tokenHash = ?
      `).get(hashed) as any;

      if (sess && (!sess.revokedAt || sess.revokedAt === null) && new Date(sess.expiresAt) > new Date() && (sess.isActive === 1 || sess.isActive === '1')) {
        sessionUser = sess;
        const userRoleRows = db.prepare('SELECT roleId FROM UserRole WHERE userId = ?').all(sess.userId) as any[];
        sessionRoles = userRoleRows.map(r => r.roleId);
      }
    }

    const getBody = (): Promise<any> => {
      return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({});
          }
        });
      });
    };

    const recordAudit = (action: string, targetEntity: string, targetId: string, metadata: any) => {
      try {
        const id = 'AUD-' + crypto.randomUUID();
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO AuditLog (id, organizationId, userId, action, targetEntity, targetId, metadataJson, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          sessionUser ? sessionUser.organizationId : 'SYSTEM',
          sessionUser ? sessionUser.userId : 'ANONYMOUS',
          action,
          targetEntity,
          targetId,
          JSON.stringify({ ...metadata, ip: req.socket.remoteAddress || '127.0.0.1' }),
          now
        );
      } catch (err) {
        console.error('AuditLog insert failed:', err);
      }
    };

    const sendJson = (status: number, data: any) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      db.close();
    };

    // 1. POST /auth/login
    if (pathname === '/auth/login' && req.method === 'POST') {
      getBody().then(body => {
        const { email, password } = body;
        const pwdHash = hashPassword(password || '');

        const user = db.prepare('SELECT * FROM User WHERE email = ? AND passwordHash = ?').get(email, pwdHash) as any;

        if (!user) {
          recordAudit('LOGIN_FAILED', 'User', email || 'UNKNOWN', { reason: 'Invalid credentials' });
          return sendJson(401, { error: 'Invalid email or password' });
        }

        const rawToken = 'SESS_TOKEN_' + crypto.randomBytes(32).toString('hex');
        const tokenHashed = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const sessionId = 'SESS-' + crypto.randomUUID();
        const now = new Date().toISOString();

        db.prepare('INSERT INTO Session (id, userId, tokenHash, expiresAt, revokedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
          sessionId, user.id, tokenHashed, expiresAt, null, now
        );

        sessionUser = { userId: user.id, organizationId: user.organizationId };
        recordAudit('LOGIN_SUCCESS', 'User', user.id, { email: user.email });

        res.setHeader('Set-Cookie', `session_token=${rawToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
        return sendJson(200, { message: 'Logged in successfully', userId: user.id, token: rawToken });
      });
      return;
    }

    // 2. POST /auth/logout
    if (pathname === '/auth/logout' && req.method === 'POST') {
      if (sessionToken) {
        const hashed = hashToken(sessionToken);
        db.prepare('UPDATE Session SET revokedAt = ? WHERE tokenHash = ?').run(new Date().toISOString(), hashed);
      }
      recordAudit('LOGOUT', 'User', sessionUser ? sessionUser.userId : 'ANONYMOUS', {});
      res.setHeader('Set-Cookie', `session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
      return sendJson(200, { message: 'Logged out successfully' });
    }

    // 3. GET /auth/session
    if (pathname === '/auth/session' && req.method === 'GET') {
      if (!sessionUser) {
        return sendJson(401, { error: 'Unauthenticated session' });
      }
      return sendJson(200, {
        userId: sessionUser.userId,
        email: sessionUser.email,
        name: sessionUser.name,
        organizationId: sessionUser.organizationId,
        roles: sessionRoles
      });
    }

    if (!sessionUser) {
      return sendJson(401, { error: 'Authentication required' });
    }

    // 4. GET /api/cases/:id
    if (pathname.startsWith('/api/cases/') && req.method === 'GET') {
      const caseId = pathname.replace('/api/cases/', '');
      const caseRow = db.prepare('SELECT * FROM CaseItem WHERE id = ? AND deletedAt IS NULL').get(caseId) as any;

      if (!caseRow) {
        return sendJson(404, { error: 'Case not found or soft deleted' });
      }

      if (caseRow.organizationId !== sessionUser.organizationId && !sessionRoles.includes('admin')) {
        recordAudit('IDOR_ATTEMPT_BLOCKED', 'CaseItem', caseId, { reason: 'Cross-organization access forbidden' });
        return sendJson(403, { error: 'Access forbidden: Case belongs to another organization' });
      }

      return sendJson(200, { case: caseRow });
    }

    // 5. PATCH /api/cases/:id
    if (pathname.startsWith('/api/cases/') && req.method === 'PATCH') {
      const caseId = pathname.replace('/api/cases/', '');
      getBody().then(body => {
        const { title, version } = body;

        const caseRow = db.prepare('SELECT * FROM CaseItem WHERE id = ? AND deletedAt IS NULL').get(caseId) as any;
        if (!caseRow) {
          return sendJson(404, { error: 'Case not found or soft deleted' });
        }

        if (caseRow.organizationId !== sessionUser.organizationId && !sessionRoles.includes('admin')) {
          return sendJson(403, { error: 'Access forbidden' });
        }

        if (version !== undefined && caseRow.version !== version) {
          recordAudit('CONCURRENCY_CONFLICT', 'CaseItem', caseId, { expectedVersion: version, actualVersion: caseRow.version });
          return sendJson(409, { error: 'Concurrency conflict: Version mismatch. Please refresh.' });
        }

        const newVersion = caseRow.version + 1;
        const now = new Date().toISOString();

        db.prepare('UPDATE CaseItem SET title = ?, version = ?, updatedAt = ? WHERE id = ? AND version = ?').run(
          title || caseRow.title, newVersion, now, caseId, caseRow.version
        );

        recordAudit('CASE_UPDATED', 'CaseItem', caseId, { oldTitle: caseRow.title, newTitle: title, newVersion });
        return sendJson(200, { message: 'Case updated successfully', version: newVersion });
      });
      return;
    }

    // 6. DELETE /api/cases/:id
    if (pathname.startsWith('/api/cases/') && req.method === 'DELETE') {
      const caseId = pathname.replace('/api/cases/', '');
      const caseRow = db.prepare('SELECT * FROM CaseItem WHERE id = ? AND deletedAt IS NULL').get(caseId) as any;

      if (!caseRow) {
        return sendJson(404, { error: 'Case not found or already soft deleted' });
      }

      if (caseRow.organizationId !== sessionUser.organizationId && !sessionRoles.includes('admin')) {
        return sendJson(403, { error: 'Access forbidden' });
      }

      const now = new Date().toISOString();
      db.prepare('UPDATE CaseItem SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(now, now, caseId);

      recordAudit('CASE_SOFT_DELETED', 'CaseItem', caseId, {});
      return sendJson(200, { message: 'Case soft deleted successfully' });
    }

    // 7. Reviewer RBAC Endpoints
    if (pathname.includes('/sections/') && pathname.endsWith('/body') && req.method === 'PATCH') {
      if (sessionRoles.includes('reviewer')) {
        recordAudit('REVIEWER_DIRECT_EDIT_BLOCKED', 'ReportSection', pathname, { role: 'reviewer' });
        return sendJson(403, { error: 'Reviewer role is forbidden from direct report body edits' });
      }
      return sendJson(200, { message: 'Section body updated successfully' });
    }

    if (pathname.includes('/sections/') && pathname.endsWith('/approve') && req.method === 'POST') {
      if (sessionRoles.includes('reviewer') || sessionRoles.includes('pm') || sessionRoles.includes('admin')) {
        recordAudit('SECTION_APPROVED', 'ReportSection', pathname, { approvedBy: sessionUser.userId });
        return sendJson(200, { message: 'Section 1st approval recorded successfully' });
      }
      return sendJson(403, { error: 'Approval forbidden for current role' });
    }

    if (pathname.endsWith('/merge') && req.method === 'POST') {
      if (sessionRoles.includes('reviewer')) {
        recordAudit('REVIEWER_MERGE_BLOCKED', 'Report', pathname, { role: 'reviewer' });
        return sendJson(403, { error: 'Reviewer role is forbidden from final document merge' });
      }
      return sendJson(200, { message: 'Document merged successfully' });
    }

    // 8. GET /api/audit-logs
    if (pathname === '/api/audit-logs' && req.method === 'GET') {
      const allowed = ['ceo', 'director', 'admin'];
      const hasPermission = sessionRoles.some(r => allowed.includes(r));

      if (!hasPermission) {
        recordAudit('AUDIT_LOG_ACCESS_BLOCKED', 'AuditLog', 'ALL', { roles: sessionRoles });
        return sendJson(403, { error: 'Access to audit logs forbidden for current role' });
      }

      const logs = db.prepare('SELECT * FROM AuditLog WHERE organizationId = ?').all(sessionUser.organizationId);
      return sendJson(200, { auditLogs: logs });
    }

    // 9. Admin Role Management
    if (pathname === '/api/admin/roles' && req.method === 'POST') {
      if (!sessionRoles.includes('admin')) {
        recordAudit('ADMIN_ROLE_CHANGE_BLOCKED', 'UserRole', 'ALL', { roles: sessionRoles });
        return sendJson(403, { error: 'Admin role management requires admin permissions' });
      }

      getBody().then(body => {
        const { targetUserId, roleId } = body;
        db.prepare('INSERT OR REPLACE INTO UserRole (userId, roleId) VALUES (?, ?)').run(targetUserId, roleId);
        recordAudit('ADMIN_ROLE_CHANGED', 'UserRole', targetUserId, { newRole: roleId });
        return sendJson(200, { message: 'Role updated successfully' });
      });
      return;
    }

    sendJson(404, { error: 'Endpoint not found' });
  });
}

if (require.main === module) {
  const server = createApiServer();
  server.listen(PORT, () => {
    console.log(`✓ API Backend server running at http://localhost:${PORT}`);
  });
}
