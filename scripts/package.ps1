$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot 'extension'
$archivePath = Join-Path $projectRoot 'xiangqi-quick-hands.zip'
Copy-Item -LiteralPath (Join-Path $projectRoot 'third_party\fairy-stockfish-b2e693ef.tar.gz') -Destination (Join-Path $extensionRoot 'engine\corresponding-source.tar.gz') -Force
$wasmSourceRoot = Join-Path $projectRoot 'third_party\pikafish-wasm'
$wasmSourceDestination = Join-Path $extensionRoot 'engine\pikafish\source'
if (!(Test-Path -LiteralPath $wasmSourceRoot -PathType Container)) {
    $wasmSourceRoot = $wasmSourceDestination
}
New-Item -ItemType Directory -Path $wasmSourceDestination -Force | Out-Null
foreach ($sourceFile in @('Pikafish-6a59ee2f-source.tar.gz', 'pikafish-wasm-v0.1.0-source.tar.gz', 'build.sh', 'source.patch', 'SOURCE.md', 'SHA256SUMS', 'UPSTREAM-README.md')) {
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $wasmSourceRoot $sourceFile))
    $destinationPath = [IO.Path]::GetFullPath((Join-Path $wasmSourceDestination $sourceFile))
    if (!(Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required browser-engine source material is missing: $sourcePath"
    }
    if ($sourcePath -ine $destinationPath) {
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }
}
Compress-Archive -Path (Join-Path $extensionRoot '*') -DestinationPath $archivePath -Force
Write-Output $archivePath

$windowsArchive = Join-Path $projectRoot 'xiangqi-pikafish-windows.zip'
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$staging = Join-Path $temporaryRoot ('xiangqi-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    foreach ($directory in @('extension', 'scripts', 'tests')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination (Join-Path $staging $directory) -Recurse
    }
    $nativeStage = Join-Path $staging 'native-host'
    New-Item -ItemType Directory -Path $nativeStage | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'native-host\host.py') -Destination $nativeStage
    foreach ($file in @('README.md', 'LICENSE', 'package.json', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $staging
    }
    Get-ChildItem -LiteralPath $projectRoot -File -Filter '*.html' | Copy-Item -Destination $staging
    $pikafishStage = Join-Path $staging 'third_party\pikafish'
    New-Item -ItemType Directory -Path $pikafishStage -Force | Out-Null
    $nativeRuntimeStage = Join-Path $pikafishStage 'runtime'
    New-Item -ItemType Directory -Path $nativeRuntimeStage -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'third_party\pikafish\runtime') -File | Where-Object { $_.Name -ne 'pikafish.nnue' } | Copy-Item -Destination $nativeRuntimeStage
    foreach ($file in @('runtime.json', 'SOURCE.md', 'Pikafish-2026-09-06-source.tar.gz')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot ('third_party\pikafish\' + $file)) -Destination $pikafishStage
    }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'third_party\fairy-stockfish-b2e693ef.tar.gz') -Destination (Join-Path $staging 'third_party')
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $windowsArchive -Force
    Write-Output $windowsArchive
} finally {
    $resolvedStaging = [System.IO.Path]::GetFullPath($staging)
    if (-not $resolvedStaging.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetFileName($resolvedStaging) -notlike 'xiangqi-package-*') {
        throw 'Refusing unexpected package staging cleanup path.'
    }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}
