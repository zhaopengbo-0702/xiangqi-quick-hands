param([string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'XiangqiQuickHands\PikafishHost'))

$ErrorActionPreference = 'Stop'
$hostName = 'com.xiangqi.quick_hands.pikafish'
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$manifestPath = Join-Path $installRoot ($hostName + '.json')
$markerPath = Join-Path $installRoot 'installation.json'
if (!(Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw "No matching native host installation exists at $installRoot" }
$marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($marker.product -ne 'xiangqi-quick-hands-pikafish-host' -or $marker.hostName -ne $hostName -or
    [IO.Path]::GetFullPath($marker.manifestPath) -ine [IO.Path]::GetFullPath($manifestPath)) {
    throw 'The installation marker does not match this native host.'
}

foreach ($browserKey in @('Microsoft\Edge', 'Google\Chrome', 'Chromium')) {
    $registryPath = "HKCU:\Software\$browserKey\NativeMessagingHosts\$hostName"
    if (Test-Path -LiteralPath $registryPath) {
        $registered = (Get-Item -LiteralPath $registryPath).GetValue('')
        if ($registered -and [IO.Path]::GetFullPath($registered) -ieq [IO.Path]::GetFullPath($manifestPath)) {
            Remove-Item -LiteralPath $registryPath -Force
        }
    }
}
foreach ($fileName in @('host.py', 'host.bat', 'config.json', ($hostName + '.json'), 'installation.json')) {
    $target = Join-Path $installRoot $fileName
    if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
}
if (@(Get-ChildItem -LiteralPath $installRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $installRoot -Force }
Write-Output 'Removed matching native-host registrations and generated host files. Engine files and user data were preserved.'
