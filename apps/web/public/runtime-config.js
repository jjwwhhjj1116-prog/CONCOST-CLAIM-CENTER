/*
 * Runtime bridge for the private company server.
 *
 * Keep this file empty in the Cloudflare preview. On the Vietnam server, replace
 * it at deploy time (or bind-mount it) without rebuilding the React bundle:
 *
 * window.__CLAIM_CENTER_COLLABORATION_URL__ = 'wss://claim.example.com/collaboration';
 * window.__CLAIM_CENTER_COLLABORATION_TOKEN_ENDPOINT__ = '/api/collaboration/token';
 * window.__CLAIM_CENTER_RHWP_STUDIO_URL__ = 'https://claim.example.com/rhwp-studio';
 *
 * Never put a JWT, API key, database password, OAuth secret, or user identity in
 * this public file. It contains service locations only.
 */
