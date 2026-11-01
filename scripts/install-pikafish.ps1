param(
    [string[]]$ExtensionId,
    [string]$PythonPath,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'XiangqiQuickHands\PikafishHost'),
    [ValidateRange(1,16)][int]$Threads = 4,
    [ValidateRange(16,1024)][int]$Hash = 128
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'extension')).TrimEnd('\')
$hostName = 'com.xiangqi.quick_hands.pikafish'
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$runtimePath = Join-Path $projectRoot 'third_party\pikafish\runtime.json'
if (!(Test-Path -LiteralPath $runtimePath -PathType Leaf)) { throw 'Official Pikafish runtime metadata is missing.' }
$runtime = Get-Content -LiteralPath $runtimePath -Raw -Encoding UTF8 | ConvertFrom-Json

function Resolve-RuntimePath([string]$Value) {
    if ([IO.Path]::IsPathRooted($Value)) { return [IO.Path]::GetFullPath($Value) }
    return [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $runtimePath) $Value))
}

$enginePath = Resolve-RuntimePath $runtime.enginePath
$networkPath = Resolve-RuntimePath $runtime.networkPath
foreach ($asset in @(@{Path=$enginePath; Expected=$runtime.engineSha256}, @{Path=$networkPath; Expected=$runtime.networkSha256})) {
    if (!(Test-Path -LiteralPath $asset.Path -PathType Leaf)) { throw "Required runtime file is missing: $($asset.Path)" }
    if ($asset.Expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $asset.Path -Algorithm SHA256).Hash -ine $asset.Expected) {
        throw "Official runtime SHA256 mismatch: $($asset.Path)"
    }
}

if (!$ExtensionId -or $ExtensionId.Count -eq 0) {
    $discoveredIds = [Collections.Generic.HashSet[string]]::new()
    $browserRoots = @('Microsoft\Edge\User Data', 'Google\Chrome\User Data', 'Chromium\User Data')
    foreach ($browser in $browserRoots) {
        $browserRoot = Join-Path $env:LOCALAPPDATA $browser
        if (!(Test-Path -LiteralPath $browserRoot -PathType Container)) { continue }
        foreach ($profile in @(Get-ChildItem -LiteralPath $browserRoot -Directory | Where-Object { $_.Name -match '^(Default|Profile \d+)$' })) {
            foreach ($preferenceName in @('Secure Preferences', 'Preferences')) {
                $preferencePath = Join-Path $profile.FullName $preferenceName
                if (!(Test-Path -LiteralPath $preferencePath -PathType Leaf)) { continue }
                try {
                    $preferences = Get-Content -LiteralPath $preferencePath -Raw -Encoding UTF8 | ConvertFrom-Json
                    foreach ($entry in $preferences.extensions.settings.PSObject.Properties) {
                        if ($entry.Name -match '^[a-p]{32}$' -and $entry.Value.path -and
                            [IO.Path]::IsPathRooted($entry.Value.path) -and
                            [IO.Path]::GetFullPath($entry.Value.path).TrimEnd('\') -ieq $extensionRoot) {
                            [void]$discoveredIds.Add($entry.Name)
                        }
                    }
                } catch { Write-Verbose "Could not inspect $preferencePath" }
            }
        }
    }
    $ExtensionId = @($discoveredIds | ForEach-Object { $_ })
}
$ExtensionId = @($ExtensionId | Select-Object -Unique)
if ($ExtensionId.Count -eq 0) { throw 'No installed extension matches this folder. Load extension/ in Edge first, or pass -ExtensionId.' }
foreach ($id in $ExtensionId) { if ($id -notmatch '^[a-p]{32}$') { throw "Invalid extension ID: $id" } }

if (!$PythonPath) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand -and $pythonCommand.Source -notlike '*\WindowsApps\*') { $PythonPath = $pythonCommand.Source }
}
if (!$PythonPath -or !(Test-Path -LiteralPath $PythonPath -PathType Leaf)) { throw 'Python 3.9 or newer is required. Pass its absolute path with -PythonPath.' }
$PythonPath = [IO.Path]::GetFullPath($PythonPath)
$pythonVersion = & $PythonPath -c 'import sys; print(sys.version.split()[0]); sys.exit(0 if sys.version_info >= (3, 9) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.9 or newer is required.' }
if ($PythonPath.Contains('%') -or $installRoot.Contains('%')) { throw 'Python and installation paths must not contain percent signs.' }
if ($PythonPath -match '[^\x20-\x7e]') { throw 'The Python executable path must use ASCII characters for the Windows batch launcher.' }

[void](New-Item -ItemType Directory -Path $installRoot -Force)
$utf8 = [Text.UTF8Encoding]::new($false)
function Write-Json([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), $utf8)
}

$hostScript = Join-Path $installRoot 'host.py'
$configPath = Join-Path $installRoot 'config.json'
$wrapperPath = Join-Path $installRoot 'host.bat'
$manifestPath = Join-Path $installRoot ($hostName + '.json')
$origins = @($ExtensionId | ForEach-Object { "chrome-extension://$_/" })
Copy-Item -LiteralPath (Join-Path $projectRoot 'native-host\host.py') -Destination $hostScript -Force
Write-Json $configPath ([ordered]@{
    enginePath=$enginePath; networkPath=$networkPath
    engineSha256=$runtime.engineSha256.ToLowerInvariant(); networkSha256=$runtime.networkSha256.ToLowerInvariant()
    version=$runtime.version; threads=$Threads; hash=$Hash; allowed_origins=$origins
})
$wrapper = "@echo off`r`n`"$PythonPath`" -u `"%~dp0host.py`" --config `"%~dp0config.json`" %*`r`n"
[IO.File]::WriteAllText($wrapperPath, $wrapper, [Text.Encoding]::ASCII)
Write-Json $manifestPath ([ordered]@{
    name=$hostName; description='Official Pikafish NNUE for Xiangqi Quick Hands'
    path=$wrapperPath; type='stdio'; allowed_origins=$origins
})
Write-Json (Join-Path $installRoot 'installation.json') ([ordered]@{
    product='xiangqi-quick-hands-pikafish-host'; hostName=$hostName
    manifestPath=$manifestPath; extensionIds=$ExtensionId; pythonPath=$PythonPath; projectRoot=$projectRoot
})

foreach ($browserKey in @('Microsoft\Edge', 'Google\Chrome', 'Chromium')) {
    $registryPath = "HKCU:\Software\$browserKey\NativeMessagingHosts\$hostName"
    [void](New-Item -Path $registryPath -Force)
    Set-Item -LiteralPath $registryPath -Value $manifestPath
}
Write-Output "Installed official Pikafish native host for $($ExtensionId -join ', ')."
Write-Output "Python: $pythonVersion; threads: $Threads; hash: $Hash MB"
Write-Output "Host manifest: $manifestPath"
Write-Output 'Reload the extension and refresh the Xiangqi board to connect.'
