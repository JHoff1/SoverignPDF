[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Package,
    [Parameter(Mandatory)]
    [string]$Pdf,
    [string]$ArtifactDirectory = "smoke-artifacts"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$packagePath = (Resolve-Path -LiteralPath $Package).Path
$pdfPath = (Resolve-Path -LiteralPath $Pdf).Path
$artifactPath = [System.IO.Path]::GetFullPath($ArtifactDirectory)
New-Item -ItemType Directory -Path $artifactPath -Force | Out-Null
$certificate = $null
$certificatePath = Join-Path $artifactPath "arm64-smoke.cer"
$unpackedPath = $null

function Find-WindowsSdkTool {
    param([Parameter(Mandatory)][string]$Name)
    $kitsRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
    $tool = Get-ChildItem -LiteralPath $kitsRoot -Filter $Name -Recurse `
        -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "\\(arm64|x64)\\$([regex]::Escape($Name))$" } |
        Sort-Object -Property FullName -Descending |
        Select-Object -First 1
    if (-not $tool) { throw "$Name was not found in the Windows SDK." }
    return $tool.FullName
}

try {
    $certificate = New-SelfSignedCertificate `
        -Type Custom `
        -Subject "CN=1561B86F-CE73-4D7B-8F44-C60003C93D75" `
        -KeyUsage DigitalSignature `
        -FriendlyName "VerityPDF CI package test" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @(
            "2.5.29.37={text}1.3.6.1.5.5.7.3.3",
            "2.5.29.19={text}"
        )
    Export-Certificate -Cert $certificate -FilePath $certificatePath | Out-Null
    Import-Certificate -FilePath $certificatePath `
        -CertStoreLocation "Cert:\CurrentUser\TrustedPeople" | Out-Null
    Import-Certificate -FilePath $certificatePath `
        -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null

    $signTool = Find-WindowsSdkTool -Name "signtool.exe"
    & $signTool sign /fd SHA256 /sha1 $certificate.Thumbprint /s My $packagePath
    if ($LASTEXITCODE -ne 0) { throw "SignTool could not sign the MSIX." }
    & $signTool verify /pa $packagePath
    if ($LASTEXITCODE -ne 0) { throw "The signed MSIX did not verify." }

    # Add-AppxPackage is not reliable on GitHub's hosted ARM image and can
    # block inside the deployment service indefinitely. Partner Center performs
    # the actual Store installation validation. Here we verify the signed MSIX,
    # unpack it with the Windows SDK, and launch its ARM64 payload natively.
    $makeAppx = Find-WindowsSdkTool -Name "makeappx.exe"
    & $makeAppx validate /p $packagePath
    if ($LASTEXITCODE -ne 0) { throw "MakeAppx rejected the ARM64 MSIX." }
    $unpackedPath = Join-Path $env:RUNNER_TEMP "veritypdf-arm64-unpacked"
    if (Test-Path -LiteralPath $unpackedPath) {
        Remove-Item -LiteralPath $unpackedPath -Recurse -Force
    }
    & $makeAppx unpack /p $packagePath /d $unpackedPath /o
    if ($LASTEXITCODE -ne 0) { throw "MakeAppx could not unpack the ARM64 MSIX." }
    $executable = Join-Path $unpackedPath "verity-pdf.exe"

    if (-not (Test-Path -LiteralPath $executable)) {
        throw "The packaged ARM64 executable is missing."
    }
    $bytes = [System.IO.File]::ReadAllBytes($executable)
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
    if ($machine -ne 0xAA64) {
        throw ("Expected PE machine AA64, found {0:X4}." -f $machine)
    }

    & (Join-Path $PSScriptRoot "smoke-windows-app.ps1") `
        -Executable $executable `
        -Pdf $pdfPath `
        -ArtifactDirectory $artifactPath `
        -Label "windows-arm64-msix"
}
finally {
    if ($certificate) {
        Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)" `
            -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath "Cert:\CurrentUser\TrustedPeople\$($certificate.Thumbprint)" `
            -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath "Cert:\CurrentUser\Root\$($certificate.Thumbprint)" `
            -Force -ErrorAction SilentlyContinue
    }
}
