import { createHash } from 'node:crypto';
import { Database } from '@hocuspocus/extension-database';
import { Server } from '@hocuspocus/server';
import { jwtVerify } from 'jose';
import pg from 'pg';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(1234),
  DATABASE_URL: z.string().min(1),
  COLLABORATION_JWT_SECRET: z.string().min(32),
  COLLABORATION_JWT_ISSUER: z.string().default('claim-center-api'),
  COLLABORATION_JWT_AUDIENCE: z.string().default('claim-center-hocuspocus'),
  APP_ORIGIN: z.string().url()
});

const claimsSchema = z.object({
  sub: z.string().min(1),
  organizationId: z.string().min(1),
  documentName: z.string().min(1),
  permission: z.enum(['read', 'write']),
  name: z.string().min(1),
  email: z.string().email(),
  jti: z.string().min(1)
});

type CollaborationContext = {
  userId: string;
  organizationId: string;
  permission: 'read' | 'write';
  name: string;
  email: string;
};

const env = envSchema.parse(process.env);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
const jwtSecret = new TextEncoder().encode(env.COLLABORATION_JWT_SECRET);

const parseRoom = (documentName: string) => {
  const match = /^claim-center:([^:]+):(proposal-[A-Za-z0-9_-]+-[1-3]|report-[A-Za-z0-9_-]+)$/u.exec(documentName);
  if (!match) throw new Error('INVALID_DOCUMENT_NAME');
  return { organizationId: match[1] };
};

const server = new Server<CollaborationContext>({
  name: 'claim-center-collaboration',
  port: env.PORT,
  address: '0.0.0.0',
  debounce: 2_000,
  maxDebounce: 10_000,
  timeout: 60_000,
  quiet: true,
  websocketOptions: { maxPayload: 2 * 1024 * 1024 },
  maxUnauthenticatedQueueSize: 1024 * 1024,
  maxUnauthenticatedQueueMessages: 200,
  maxPendingDocuments: 5,
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        parseRoom(documentName);
        const result = await pool.query<{ yjs_state: Buffer }>(
          'SELECT yjs_state FROM collaboration_documents WHERE document_name = $1',
          [documentName]
        );
        return result.rows[0]?.yjs_state ? new Uint8Array(result.rows[0].yjs_state) : null;
      },
      store: async ({ documentName, state }) => {
        const room = parseRoom(documentName);
        const sha256 = createHash('sha256').update(state).digest('hex');
        await pool.query(
          `INSERT INTO collaboration_documents
             (organization_id, document_name, yjs_state, state_sha256, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (organization_id, document_name)
           DO UPDATE SET yjs_state = EXCLUDED.yjs_state,
                         state_sha256 = EXCLUDED.state_sha256,
                         updated_at = now()`,
          [room.organizationId, documentName, Buffer.from(state), sha256]
        );
      }
    })
  ],
  onConnect: async ({ requestHeaders }) => {
    if (requestHeaders.get('origin') !== env.APP_ORIGIN) throw new Error('ORIGIN_NOT_ALLOWED');
  },
  onAuthenticate: async ({ token, documentName, connectionConfig }) => {
    const verified = await jwtVerify(token, jwtSecret, {
      issuer: env.COLLABORATION_JWT_ISSUER,
      audience: env.COLLABORATION_JWT_AUDIENCE
    });
    const claims = claimsSchema.parse(verified.payload);
    const room = parseRoom(documentName);
    if (claims.documentName !== documentName) throw new Error('DOCUMENT_TOKEN_MISMATCH');
    if (claims.organizationId !== room.organizationId) throw new Error('ORGANIZATION_MISMATCH');
    if (claims.permission === 'read') connectionConfig.readOnly = true;
    return {
      userId: claims.sub,
      organizationId: claims.organizationId,
      permission: claims.permission,
      name: claims.name,
      email: claims.email
    };
  }
});

const shutdown = async () => {
  await server.destroy();
  await pool.end();
  process.exit(0);
};

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
await server.listen();
