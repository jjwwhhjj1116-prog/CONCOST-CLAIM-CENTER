param(
  [string]$OutputDirectory = 'deliverables',
  [string]$BundleName = '',
  [switch]$WithoutDevDatabase
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$head = (git -C $repositoryRoot rev-parse HEAD).Trim()
$shortHead = $head.Substring(0, 7)
$branch = (git -C $repositoryRoot branch --show-current).Trim()
$releaseDate = Get-Date -Format 'yyyyMMdd'
if ([string]::IsNullOrWhiteSpace($BundleName)) {
  $BundleName = "CONCOST_CLAIM_CENTER_FULL_SOURCE_${releaseDate}_${shortHead}"
}

$deliverablesRoot = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  $OutputDirectory
} else {
  Join-Path $repositoryRoot $OutputDirectory
}
$bundleRoot = Join-Path $deliverablesRoot $BundleName
$zipPath = "$bundleRoot.zip"
$sourceArchive = Join-Path ([System.IO.Path]::GetTempPath()) "$BundleName-source.zip"

if (Test-Path -LiteralPath $bundleRoot) { throw "Bundle directory already exists: $bundleRoot" }
if (Test-Path -LiteralPath $zipPath) { throw "Bundle ZIP already exists: $zipPath" }
if (Test-Path -LiteralPath $sourceArchive) { Remove-Item -LiteralPath $sourceArchive -Force }

New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
$sourceRoot = Join-Path $bundleRoot 'source'
$serverDataRoot = Join-Path $bundleRoot 'server-data'
New-Item -ItemType Directory -Path $sourceRoot, $serverDataRoot -Force | Out-Null

$archivePaths = @(
  '.codex',
  'AGENTS.md',
  'apps',
  'packages',
  'scripts',
  'docs',
  'artifacts/harness',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  'eslint.config.mjs',
  'wrangler.jsonc',
  'README.md',
  '.gitignore',
  '.editorconfig',
  '.node-version',
  '.npmrc',
  '01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS.md',
  '01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS_v2.md',
  '03_CLAIM_6_TYPE_TEMPLATE_MAPPING_SPEC.md'
)
$archiveArguments = @('-C', $repositoryRoot, 'archive', '--format=zip', "--output=$sourceArchive", 'HEAD', '--') + $archivePaths
& git @archiveArguments
if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
Expand-Archive -LiteralPath $sourceArchive -DestinationPath $sourceRoot
Remove-Item -LiteralPath $sourceArchive -Force

if (Test-Path -LiteralPath (Join-Path $sourceRoot 'deliverables')) {
  throw 'Unsafe stale deliverables were included in the source archive.'
}
if ((Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Filter '*.db').Count -ne 0) {
  throw 'Unexpected database file found inside the Git source archive.'
}
$requiredSourceFiles = @(
  'apps/cloudflare/src/index.ts',
  'apps/cloudflare/migrations/0046_cf69_proposal_asset_versions.sql',
  'apps/web/src/App.tsx',
  'apps/api/src/server.ts',
  'packages/database/prisma/schema.prisma',
  'packages/database/prisma/migrations/20260827090000_server_settings_adapter/migration.sql',
  'pnpm-lock.yaml',
  'AGENTS.md',
  '.codex/config.toml',
  'docs/runbooks/vietnam-weekly-sqlite-update.md'
)
foreach ($required in $requiredSourceFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $required) -PathType Leaf)) {
    throw "Required full-source file is missing: $required"
  }
}

$readmeSource = Join-Path $repositoryRoot 'docs/runbooks/vietnam-full-source-package-readme.md'
Copy-Item -LiteralPath $readmeSource -Destination (Join-Path $bundleRoot 'README_FIRST.md')

$databaseIncluded = -not $WithoutDevDatabase
$databaseRelative = 'packages/database/.data/dev.db'
$databaseSource = Join-Path $repositoryRoot $databaseRelative
if ($databaseIncluded) {
  if (-not (Test-Path -LiteralPath $databaseSource -PathType Leaf)) {
    throw "Requested dev.db is missing: $databaseSource"
  }
  Copy-Item -LiteralPath $databaseSource -Destination (Join-Path $serverDataRoot 'dev.db')
}

$trackedStatus = git -C $repositoryRoot status --porcelain=v1 --untracked-files=no
if ($LASTEXITCODE -ne 0) { throw 'git status failed.' }
if (-not [string]::IsNullOrWhiteSpace(($trackedStatus -join "`n"))) {
  throw "Tracked worktree changes exist. Commit them before building the package.`n$($trackedStatus -join "`n")"
}

$releaseLines = @(
  'CONCOST Claim Center full source release',
  "GeneratedAtKST: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
  "GitBranch: $branch",
  "GitCommit: $head",
  "SourceFileCount: $((Get-ChildItem -LiteralPath $sourceRoot -Recurse -File).Count)",
  "DevDatabaseIncluded: $databaseIncluded",
  'DevDatabasePathInPackage: server-data/dev.db',
  'LatestCloudflareD1Migration: 0046_cf69_proposal_asset_versions.sql',
  'LatestNodeSQLiteMigration: 20260827090000_server_settings_adapter',
  'TrackedDeliverablesExcluded: true',
  'PlaintextSecretsIncluded: false',
  'Important: Existing production dev.db must not be overwritten. See README_FIRST.md.'
)
[System.IO.File]::WriteAllLines((Join-Path $bundleRoot 'RELEASE_INFO.txt'), $releaseLines, [System.Text.UTF8Encoding]::new($false))

$checksums = Get-ChildItem -LiteralPath $bundleRoot -Recurse -File |
  Where-Object { $_.Name -ne 'SHA256SUMS.txt' } |
  Sort-Object FullName |
  ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($bundleRoot, $_.FullName).Replace('\\', '/')
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $relative"
  }
[System.IO.File]::WriteAllLines((Join-Path $bundleRoot 'SHA256SUMS.txt'), $checksums, [System.Text.UTF8Encoding]::new($false))

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($bundleRoot, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "Bundle: $zipPath"
Write-Output "SHA256: $zipHash"
Write-Output "GitCommit: $head"
Write-Output "DevDatabaseIncluded: $databaseIncluded"
