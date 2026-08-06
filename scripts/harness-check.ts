import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const mode = process.argv[2];
const root = path.join(__dirname, '..');
const tscCli = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const eslintCli = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
const prismaCli = path.join(root, 'packages', 'database', 'node_modules', 'prisma', 'build', 'index.js');
const viteCli = path.join(root, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js');

function runNode(modulePath: string, args: string[], cwd = root): void {
  execFileSync(process.execPath, [modulePath, ...args], { cwd, stdio: 'inherit' });
}

function runTsc(args: string[]): void {
  runNode(tscCli, args);
}

function runWorkspaceTypecheck(): void {
  console.log('[Harness] Type-checking scripts, UI, web, database, and API workspaces...');
  runTsc(['-b', 'packages/database/tsconfig.json', 'apps/api/tsconfig.json', '--pretty', 'false']);
  runTsc(['--noEmit']);
  runTsc(['-p', 'packages/ui/tsconfig.json', '--noEmit']);
  runTsc(['-p', 'apps/web/tsconfig.json', '--noEmit']);
}

if (mode === 'lint') {
  runWorkspaceTypecheck();
  runNode(eslintCli, ['scripts', 'apps/web/src', 'apps/api/src', 'packages/ui/src', 'packages/database/src', '--max-warnings', '0']);
  for (const relativePath of [
    'package.json',
    'apps/web/package.json',
    'apps/api/package.json',
    'packages/ui/package.json',
    'packages/database/package.json',
    'apps/web/tsconfig.json',
    'packages/ui/tsconfig.json',
    'docs/stitch/design-tokens.json',
    'docs/harness/phase-status.json',
    'artifacts/harness/P03/manifest.json',
    'artifacts/harness/P04/manifest.json'
  ]) {
    JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  }
  console.log('[Harness] Lint and JSON validation passed with zero warnings.');
} else if (mode === 'typecheck') {
  runWorkspaceTypecheck();
} else if (mode === 'build') {
  runWorkspaceTypecheck();
  runTsc(['-p', 'packages/ui/tsconfig.json']);
  runNode(prismaCli, ['generate', '--schema', 'prisma/schema.prisma'], path.join(root, 'packages', 'database'));
  runTsc(['-b', 'packages/database/tsconfig.json', 'apps/api/tsconfig.json', '--force', '--pretty', 'false']);
  runTsc(['-p', 'apps/web/tsconfig.json', '--noEmit']);
  runNode(viteCli, ['build'], path.join(root, 'apps', 'web'));
  const requiredArtifacts = [
    'packages/ui/dist/index.js',
    'packages/ui/dist/index.d.ts',
    'packages/database/dist/index.js',
    'apps/api/dist/server.js',
    'apps/web/dist/index.html'
  ];
  for (const artifact of requiredArtifacts) {
    if (!fs.existsSync(path.join(root, artifact))) throw new Error(`Build artifact missing: ${artifact}`);
  }
  console.log('[Harness] UI, database, API, and production web build artifacts verified.');
} else {
  throw new Error(`Unknown harness target: ${mode}`);
}
