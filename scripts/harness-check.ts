import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const mode = process.argv[2];
const root = path.join(__dirname, '..');
const pnpmArgs = ['--yes', 'pnpm@9.15.0'];

function run(command: string, args: string[]): void {
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], { cwd: root, stdio: 'inherit' });
    return;
  }
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
}

function runWorkspaceTypecheck(): void {
  console.log('[Harness] Type-checking scripts, packages/ui, and apps/web...');
  run('npx', ['tsc', '--noEmit']);
  run('npx', [...pnpmArgs, '--filter', '@claim-studio/ui', 'typecheck']);
  run('npx', [...pnpmArgs, '--filter', 'claim-center-report-studio-web', 'typecheck']);
}

if (mode === 'lint') {
  runWorkspaceTypecheck();
  run('npx', ['eslint', 'scripts', 'apps/web/src', 'packages/ui/src', '--max-warnings', '0']);
  for (const relativePath of [
    'package.json',
    'apps/web/package.json',
    'packages/ui/package.json',
    'apps/web/tsconfig.json',
    'packages/ui/tsconfig.json',
    'docs/stitch/design-tokens.json',
    'docs/harness/phase-status.json',
    'artifacts/harness/P03/manifest.json'
  ]) {
    JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  }
  console.log('[Harness] Lint and JSON validation passed with zero warnings.');
} else if (mode === 'typecheck') {
  runWorkspaceTypecheck();
} else if (mode === 'build') {
  runWorkspaceTypecheck();
  run('npx', [...pnpmArgs, '--filter', '@claim-studio/ui', 'build']);
  run('npx', [...pnpmArgs, '--filter', 'claim-center-report-studio-web', 'build']);
  const requiredArtifacts = [
    'packages/ui/dist/index.js',
    'packages/ui/dist/index.d.ts',
    'apps/web/dist/index.html'
  ];
  for (const artifact of requiredArtifacts) {
    if (!fs.existsSync(path.join(root, artifact))) throw new Error(`Build artifact missing: ${artifact}`);
  }
  console.log('[Harness] UI package and production web application build artifacts verified.');
} else {
  throw new Error(`Unknown harness target: ${mode}`);
}
