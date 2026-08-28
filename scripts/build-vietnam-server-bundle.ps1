param(
  [string]$BundleName = 'CONCOST_Vietnam_Server_Bridge_2026-08-25'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$deliverablesRoot = Join-Path $repositoryRoot 'deliverables'
$bundleRoot = Join-Path $deliverablesRoot $BundleName
$zipPath = "$bundleRoot.zip"

if (Test-Path -LiteralPath $bundleRoot) {
  throw "Bundle directory already exists: $bundleRoot"
}
if (Test-Path -LiteralPath $zipPath) {
  throw "Bundle ZIP already exists: $zipPath"
}

New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null

function Copy-RepositoryFile {
  param(
    [Parameter(Mandatory = $true)][string]$SourceRelative,
    [Parameter(Mandatory = $true)][string]$DestinationRelative
  )

  $source = Join-Path $repositoryRoot $SourceRelative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Required source file is missing: $SourceRelative"
  }
  $destination = Join-Path $bundleRoot $DestinationRelative
  $destinationDirectory = Split-Path -Parent $destination
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination
}

Copy-RepositoryFile 'docs/vietnam-server-kit/VIETNAM_DEVELOPER_START_HERE.md' 'README_FIRST.md'
Copy-RepositoryFile 'docs/runbooks/vietnam-primary-server-migration-handoff.md' 'handoff/vietnam-primary-server-migration-handoff.md'
Copy-RepositoryFile 'docs/runbooks/vietnam-weekly-sqlite-update.md' 'handoff/vietnam-weekly-sqlite-update.md'
Copy-RepositoryFile 'docs/runbooks/vietnam-yjs-hocuspocus-handoff.md' 'handoff/vietnam-yjs-hocuspocus-handoff.md'
Copy-RepositoryFile 'docs/runbooks/vietnam-hermes-private-bridge.md' 'handoff/vietnam-hermes-private-bridge.md'
Copy-RepositoryFile 'docs/runbooks/document-authoring-platform.md' 'handoff/document-authoring-platform.md'

$serverKitSource = Join-Path $repositoryRoot 'docs/vietnam-server-kit'
$serverKitDestination = Join-Path $bundleRoot 'server-kit'
Copy-Item -LiteralPath $serverKitSource -Destination $serverKitDestination -Recurse

$webOverlayFiles = @(
  'apps/web/index.html',
  'apps/web/package.json',
  'apps/web/public/runtime-config.js',
  'apps/web/src/App.tsx',
  'apps/web/src/main.tsx',
  'apps/web/src/documents/RhwpEditorDialog.tsx',
  'apps/web/src/documents/StructuredDocumentEditor.tsx',
  'apps/web/src/documents/StructuredDocumentCollaboration.css',
  'apps/web/src/proposals/ProposalView.tsx',
  'apps/web/src/reports/ReportStudio.tsx',
  'apps/web/src/routes/PreviewReportStudio.tsx'
)
foreach ($file in $webOverlayFiles) {
  Copy-RepositoryFile $file (Join-Path 'web-overlay' $file)
}

Copy-RepositoryFile 'package.json' 'repository-contract/package.json'
Copy-RepositoryFile 'pnpm-lock.yaml' 'repository-contract/pnpm-lock.yaml'
Copy-RepositoryFile 'scripts/cf58-schedule-print-hwp-test.ts' 'tests/cf58-schedule-print-hwp-test.ts'
Copy-RepositoryFile 'scripts/cf60-structured-document-editor-test.ts' 'tests/cf60-structured-document-editor-test.ts'
Copy-RepositoryFile 'scripts/cf61-realtime-collaboration-test.ts' 'tests/cf61-realtime-collaboration-test.ts'

$manifestPath = Join-Path $bundleRoot 'MANIFEST-SHA256.txt'
$manifestLines = Get-ChildItem -LiteralPath $bundleRoot -File -Recurse |
  Where-Object { $_.FullName -ne $manifestPath } |
  Sort-Object FullName |
  ForEach-Object {
    $relativePath = [System.IO.Path]::GetRelativePath($bundleRoot, $_.FullName).Replace('\', '/')
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $relativePath"
  }
[System.IO.File]::WriteAllLines($manifestPath, $manifestLines, [System.Text.UTF8Encoding]::new($false))

Compress-Archive -Path (Join-Path $bundleRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()

[PSCustomObject]@{
  BundleDirectory = $bundleRoot
  ZipPath = $zipPath
  ZipSha256 = $zipHash
  FileCount = (Get-ChildItem -LiteralPath $bundleRoot -File -Recurse).Count
}
