[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $PSScriptRoot -ChildPath "..")
)
$tauriRoot = Join-Path -Path $repositoryRoot -ChildPath "src-tauri"
$storeRoot = Join-Path -Path $tauriRoot -ChildPath "target\store"
$stagingRoot = Join-Path -Path $storeRoot -ChildPath "staging"
$verificationRoot = Join-Path -Path $storeRoot -ChildPath "verification"
$manifestTemplatePath = Join-Path -Path $tauriRoot -ChildPath "store\AppxManifest.xml"
$configurationPath = Join-Path -Path $tauriRoot -ChildPath "tauri.conf.json"
$executablePath = Join-Path -Path $tauriRoot -ChildPath "target\release\sovereign-pdf.exe"
$iconPath = Join-Path -Path $tauriRoot -ChildPath "icons\app-icon.png"

$expectedStoreRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $repositoryRoot -ChildPath "src-tauri\target\store")
)
if (-not $storeRoot.Equals(
    $expectedStoreRoot,
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw "Refusing to clean an unexpected Store output path: $storeRoot"
}

$configuration = Get-Content -LiteralPath $configurationPath -Raw |
    ConvertFrom-Json
$versionParts = [string]$configuration.version -split "\."
if ($versionParts.Count -lt 3 -or $versionParts.Count -gt 4) {
    throw "The Tauri version must contain three or four numeric parts."
}
if ($versionParts | Where-Object { $_ -notmatch "^\d+$" }) {
    throw "The Tauri version must contain only numeric parts for MSIX."
}

$numericParts = @($versionParts | ForEach-Object { [int]$_ })
while ($numericParts.Count -lt 4) {
    $numericParts += 0
}
if ($numericParts | Where-Object { $_ -lt 0 -or $_ -gt 65535 }) {
    throw "Each MSIX version component must be between 0 and 65535."
}
$packageVersion = $numericParts -join "."

$windowsKitsRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
$makeAppx = Get-ChildItem -LiteralPath $windowsKitsRoot `
    -Filter "makeappx.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\makeappx\.exe$" } |
    Sort-Object -Property FullName -Descending |
    Select-Object -First 1
if (-not $makeAppx) {
    throw "MakeAppx.exe was not found. Install the Windows 10 or 11 SDK."
}

$cargoBin = Join-Path -Path $env:USERPROFILE -ChildPath ".cargo\bin"
if ((Test-Path -LiteralPath $cargoBin) -and
    (($env:PATH -split ";") -notcontains $cargoBin)) {
    $env:PATH = "$cargoBin;$env:PATH"
}

if (-not $SkipBuild) {
    Push-Location -LiteralPath $repositoryRoot
    try {
        & npm run tauri -- build --no-bundle
        if ($LASTEXITCODE -ne 0) {
            throw "The Tauri release build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $executablePath)) {
    throw "The release executable was not found at $executablePath."
}
if (-not (Test-Path -LiteralPath $iconPath)) {
    throw "The Store icon source was not found at $iconPath."
}

if (Test-Path -LiteralPath $storeRoot) {
    Remove-Item -LiteralPath $storeRoot -Recurse -Force
}
$assetsRoot = New-Item -ItemType Directory -Path (
    Join-Path -Path $stagingRoot -ChildPath "Assets"
) -Force
$null = New-Item -ItemType Directory -Path $verificationRoot -Force

Copy-Item -LiteralPath $executablePath -Destination (
    Join-Path -Path $stagingRoot -ChildPath "sovereign-pdf.exe"
)

Add-Type -AssemblyName System.Drawing
function Export-SquarePng {
    param(
        [Parameter(Mandatory)]
        [string]$Source,
        [Parameter(Mandatory)]
        [string]$Destination,
        [Parameter(Mandatory)]
        [int]$Size
    )

    $sourceImage = [System.Drawing.Image]::FromFile($Source)
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($sourceImage, 0, 0, $Size, $Size)
        $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
        $sourceImage.Dispose()
    }
}

Export-SquarePng -Source $iconPath -Destination (
    Join-Path $assetsRoot "StoreLogo.png"
) -Size 50
Export-SquarePng -Source $iconPath -Destination (
    Join-Path $assetsRoot "Square44x44Logo.png"
) -Size 44
Export-SquarePng -Source $iconPath -Destination (
    Join-Path $assetsRoot "Square150x150Logo.png"
) -Size 150

$manifest = (Get-Content -LiteralPath $manifestTemplatePath -Raw).Replace(
    "__PACKAGE_VERSION__",
    $packageVersion
)
$manifestPath = Join-Path -Path $stagingRoot -ChildPath "AppxManifest.xml"
[System.IO.File]::WriteAllText(
    $manifestPath,
    $manifest,
    [System.Text.UTF8Encoding]::new($false)
)

$packageName = "SovereignPDF_{0}_x64.msix" -f $packageVersion
$packagePath = Join-Path -Path $storeRoot -ChildPath $packageName
& $makeAppx.FullName pack /d $stagingRoot /p $packagePath /o /h SHA256
if ($LASTEXITCODE -ne 0) {
    throw "MakeAppx failed to create the MSIX package."
}

& $makeAppx.FullName unpack /p $packagePath /d $verificationRoot /o
if ($LASTEXITCODE -ne 0) {
    throw "MakeAppx could not verify and unpack the generated MSIX."
}

$packageHash = Get-FileHash -LiteralPath $packagePath -Algorithm SHA256
$hashPath = "$packagePath.sha256"
"{0}  {1}" -f $packageHash.Hash.ToLowerInvariant(), $packageName |
    Set-Content -LiteralPath $hashPath -Encoding ascii

Write-Host ""
Write-Host "Microsoft Store package created successfully:"
Write-Host "  Package: $packagePath"
Write-Host "  Version: $packageVersion"
Write-Host "  SHA-256: $($packageHash.Hash)"
Write-Host ""
Write-Host "Upload the .msix file on the Packages page in Partner Center."
