param(
  [string]$PackagePath = (
    Join-Path $PSScriptRoot `
      "..\src-tauri\target\store\x64\VerityPDF_0.1.14.0_x64.msix"
  )
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)) {
  throw @"
Windows App Certification Kit must run as administrator in an active user
session. Open an elevated PowerShell window and run:

  npm run store:wack
"@
}

$appCert = Join-Path ${env:ProgramFiles(x86)} `
  "Windows Kits\10\App Certification Kit\appcert.exe"
if (-not (Test-Path -LiteralPath $appCert)) {
  throw "Windows App Certification Kit is not installed: $appCert"
}

$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$reportDirectory = Join-Path $PSScriptRoot `
  "..\src-tauri\target\store\certification"
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
$reportPath = Join-Path $reportDirectory "VerityPDF-WACK-report.xml"

Write-Host "Resetting Windows App Certification Kit..."
& $appCert reset
if ($LASTEXITCODE -ne 0) {
  throw "Windows App Certification Kit reset failed with exit code $LASTEXITCODE."
}

Write-Host "Testing $resolvedPackage..."
& $appCert test `
  -appxpackagepath $resolvedPackage `
  -reportoutputpath $reportPath
if ($LASTEXITCODE -ne 0) {
  throw "Windows App Certification Kit failed with exit code $LASTEXITCODE."
}

Write-Host "Certification report: $reportPath"
