$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot 'extension'
$extensionVersion = (Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($extensionVersion -notmatch '^\d+\.\d+\.\d+$' -or $extensionVersion -ne $packageVersion) {
    throw 'Extension and package versions must match before packaging.'
}
$archiveName = "xiangqi-quick-hands-v$extensionVersion.zip"
$archivePath = Join-Path $projectRoot $archiveName
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
$hashProvider = [Security.Cryptography.SHA256]::Create()
$archiveStream = [IO.File]::OpenRead($archivePath)
try {
    $archiveHash = [BitConverter]::ToString($hashProvider.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant()
} finally {
    $archiveStream.Dispose()
    $hashProvider.Dispose()
}
$checksumPath = Join-Path $projectRoot 'SHA256SUMS.txt'
[IO.File]::WriteAllText($checksumPath, "$archiveHash  $archiveName`n", [Text.Encoding]::ASCII)
Write-Output $archivePath
Write-Output $checksumPath
