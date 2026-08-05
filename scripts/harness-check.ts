import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const mode: string = process.argv[2];
console.log(`[Harness Engine TS] Executing target: ${mode}`);

function runTypeCheck(): void {
  console.log('[Harness Engine TS] Performing strict TypeScript type check (tsc --noEmit)...');
  try {
    execSync('npx tsc --noEmit', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('  ✓ TypeScript strict type check PASSED.');
  } catch {
    console.error('  ✗ TypeScript type check FAILED! Blocking execution.');
    process.exit(1);
  }
}

if (mode === 'lint') {
  runTypeCheck();
  console.log('[Harness Lint] Executing real ESLint engine (max-warnings=0)...');
  try {
    execSync('npx eslint scripts/**/*.ts --max-warnings 0', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('  ✓ ESLint static code analysis PASSED (0 warnings).');
  } catch {
    console.error('  ✗ ESLint static code analysis FAILED!');
    process.exit(1);
  }

  console.log('[Harness Lint] Verifying JSON syntax and file encoding...');
  const jsonFiles: string[] = [
    'package.json',
    'tsconfig.base.json',
    'tsconfig.json',
    'docs/harness/phase-status.json',
    'docs/harness/initial-state.json',
    'artifacts/harness/P00/manifest.json'
  ];

  for (const f of jsonFiles) {
    const fullPath: string = path.join(__dirname, '..', f);
    try {
      const content: string = fs.readFileSync(fullPath, 'utf8');
      JSON.parse(content);
      console.log(`  ✓ JSON valid: ${f}`);
    } catch (e: any) {
      console.error(`  ✗ Invalid JSON in ${f}: ${e.message}`);
      process.exit(1);
    }
  }
  console.log('[Harness Lint] All linters passed.');
} else if (mode === 'build') {
  runTypeCheck();
  console.log('[Harness Build] Compiling TypeScript source files to dist/ artifacts...');
  const distDir: string = path.join(__dirname, '../dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  try {
    execSync('npx tsc --outDir dist --declaration', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('  ✓ TypeScript emit/compilation to dist/ PASSED.');
  } catch {
    console.error('  ✗ TypeScript compilation failed during build!');
    process.exit(1);
  }

  fs.writeFileSync(path.join(distDir, 'build-manifest.json'), JSON.stringify({
    buildTime: new Date().toISOString(),
    status: 'SUCCESS',
    phase: 'P00',
    artifacts: fs.readdirSync(distDir)
  }, null, 2));
  console.log('[Harness Build] Real workspace artifact compilation complete.');
} else {
  console.error(`[Harness Engine] Unknown target: ${mode}`);
  process.exit(1);
}
