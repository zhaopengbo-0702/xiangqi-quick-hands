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
