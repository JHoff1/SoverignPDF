[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$PackagesPath,
    [Parameter(Mandatory)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$resolvedPackagesPath = (Resolve-Path -LiteralPath $PackagesPath).Path
$packages = @(
    Get-ChildItem -LiteralPath $resolvedPackagesPath -Filter "*.msix" `
        -File -Recurse
)
if ($packages.Count -ne 2) {
    throw "Expected exactly two Store MSIX packages; found $($packages.Count)."
}

$metadata = foreach ($package in $packages) {
    if ($package.Name -notmatch (
        "^VerityPDF_(\d+\.\d+\.\d+\.\d+)_(x64|arm64)\.msix$"
    )) {
        throw "Unexpected Store package name: $($package.Name)"
    }

    [pscustomobject]@{
        File = $package
        Version = $Matches[1]
        Architecture = $Matches[2]
    }
}

$versions = @($metadata.Version | Sort-Object -Unique)
if ($versions.Count -ne 1) {
    throw "The x64 and ARM64 Store packages must have the same version."
}
$packageVersion = $versions[0]

$architectures = @($metadata.Architecture | Sort-Object -Unique)
if ($architectures.Count -ne 2 -or
    $architectures -notcontains "x64" -or
    $architectures -notcontains "arm64") {
    throw "The Store upload must contain one x64 and one ARM64 package."
}

$windowsKitsRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
$makeAppx = Get-ChildItem -LiteralPath $windowsKitsRoot `
    -Filter "makeappx.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\makeappx\.exe$" } |
    Sort-Object -Property FullName -Descending |
    Select-Object -First 1
if (-not $makeAppx) {
    throw "MakeAppx.exe was not found. Install the Windows 10 or 11 SDK."
}

$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if ([System.IO.Path]::GetExtension($resolvedOutputPath) -ne ".msixupload") {
    throw "The Store upload output path must end in .msixupload."
}
if (Test-Path -LiteralPath $resolvedOutputPath) {
    throw "The Store upload output already exists: $resolvedOutputPath"
}
$outputDirectory = Split-Path -Parent $resolvedOutputPath
$null = New-Item -ItemType Directory -Path $outputDirectory -Force

$workingRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    "veritypdf-store-upload-{0}" -f [guid]::NewGuid().ToString("N")
)
$bundleContent = Join-Path $workingRoot "bundle-content"
$verificationRoot = Join-Path $workingRoot "verification"
$bundleName = "VerityPDF_{0}.msixbundle" -f $packageVersion
$bundlePath = Join-Path $workingRoot $bundleName
$uploadZip = Join-Path $workingRoot "VerityPDF.zip"

try {
    $null = New-Item -ItemType Directory -Path $bundleContent -Force
    $null = New-Item -ItemType Directory -Path $verificationRoot -Force
    foreach ($item in $metadata) {
        Copy-Item -LiteralPath $item.File.FullName -Destination $bundleContent
    }

    & $makeAppx.FullName bundle /d $bundleContent /p $bundlePath /o `
        /bv $packageVersion
    if ($LASTEXITCODE -ne 0) {
        throw "MakeAppx failed to create the multi-architecture MSIX bundle."
    }

    & $makeAppx.FullName unbundle /p $bundlePath /d $verificationRoot /o
    if ($LASTEXITCODE -ne 0) {
        throw "MakeAppx could not verify the generated MSIX bundle."
    }

    $verifiedPackages = @(
        Get-ChildItem -LiteralPath $verificationRoot -Filter "*.msix" `
            -File -Recurse
    )
    if ($verifiedPackages.Count -ne 2) {
        throw (
            "The generated bundle contains $($verifiedPackages.Count) " +
            "packages instead of two."
        )
    }
    foreach ($architecture in @("x64", "arm64")) {
        if (-not ($verifiedPackages.Name -match "_${architecture}\.msix$")) {
            throw "The generated bundle is missing its $architecture package."
        }
    }

    Compress-Archive -LiteralPath $bundlePath -DestinationPath $uploadZip `
        -CompressionLevel Optimal
    Move-Item -LiteralPath $uploadZip -Destination $resolvedOutputPath

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedOutputPath)
    try {
        $entries = @($archive.Entries)
        if ($entries.Count -ne 1 -or $entries[0].Name -ne $bundleName) {
            throw "The Store upload must contain exactly one MSIX bundle."
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    if (Test-Path -LiteralPath $workingRoot) {
        Remove-Item -LiteralPath $workingRoot -Recurse -Force
    }
}

$uploadHash = Get-FileHash -LiteralPath $resolvedOutputPath -Algorithm SHA256
Write-Host ""
Write-Host "Microsoft Store upload created successfully:"
Write-Host "  Upload: $resolvedOutputPath"
Write-Host "  Bundle: $bundleName"
Write-Host "  Version: $packageVersion"
Write-Host "  Architectures: x64, ARM64"
Write-Host "  SHA-256: $($uploadHash.Hash)"
