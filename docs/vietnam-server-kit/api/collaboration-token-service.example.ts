import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';

type SessionUser = { id: string; name: string; email: string; organizationId: string; roles: string[] };
type Permission = 'read' | 'write';

export interface CollaborationAuthorization {
  permission: Permission;
  locked: boolean;
}

export async function issueCollaborationToken(input: {
  session: SessionUser;
  documentName: string;
  jwtSecret: string;
  authorizeDocument: (session: SessionUser, documentName: string) => Promise<CollaborationAuthorization>;
}) {
  if (!input.documentName.startsWith(`claim-center:${input.session.organizationId}:`)) {
    throw Object.assign(new Error('DOCUMENT_ACCESS_DENIED'), { status: 403 });
  }
  const authorization = await input.authorizeDocument(input.session, input.documentName);
  const permission: Permission = authorization.locked ? 'read' : authorization.permission;
  const secret = new TextEncoder().encode(input.jwtSecret);
  const token = await new SignJWT({
    organizationId: input.session.organizationId,
    documentName: input.documentName,
    permission,
    name: input.session.name,
    email: input.session.email
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('claim-center-api')
    .setAudience('claim-center-hocuspocus')
    .setSubject(input.session.id)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
  return { token };
}

/*
 * POST /api/collaboration/token handler must:
 * 1) read the HttpOnly application session;
 * 2) validate JSON { documentName };
 * 3) call issueCollaborationToken with a PostgreSQL-backed authorizeDocument;
 * 4) return { token }; and
 * 5) never log the cookie or token.
 */
