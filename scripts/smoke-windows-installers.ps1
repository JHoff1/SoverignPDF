[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Msi,
    [Parameter(Mandatory)][string]$Nsis,
    [Parameter(Mandatory)][string]$Pdf,
    [string]$PreviousMsi,
    [string]$PreviousNsis,
    [string]$ArtifactDirectory = "smoke-artifacts"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$msiPath = (Resolve-Path -LiteralPath $Msi).Path
$nsisPath = (Resolve-Path -LiteralPath $Nsis).Path
$pdfPath = (Resolve-Path -LiteralPath $Pdf).Path
$artifactPath = [System.IO.Path]::GetFullPath($ArtifactDirectory)
New-Item -ItemType Directory -Path $artifactPath -Force | Out-Null

function Invoke-Msi {
    param([string[]]$Arguments)
    $process = Start-Process msiexec.exe -ArgumentList $Arguments -Wait -PassThru
    if ($process.ExitCode -notin @(0, 1641, 3010)) {
        throw "msiexec failed with exit code $($process.ExitCode)."
    }
}

function Get-VerityInstall {
    $entries = @(
        Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
            -ErrorAction SilentlyContinue
        Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
            -ErrorAction SilentlyContinue
        Get-ItemProperty "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" `
            -ErrorAction SilentlyContinue
    ) | Where-Object { $_.DisplayName -like "VerityPDF*" } |
        Sort-Object { [version]($_.DisplayVersion -replace '[^0-9.]', '') } -Descending
    return $entries | Select-Object -First 1
}

function Find-InstalledExecutable {
    $entry = Get-VerityInstall
    $candidates = @()
    if ($entry -and $entry.InstallLocation) {
        $candidates += Join-Path $entry.InstallLocation "VerityPDF.exe"
        $candidates += Join-Path $entry.InstallLocation "verity-pdf.exe"
    }
    $candidates += "$env:LOCALAPPDATA\VerityPDF\VerityPDF.exe"
    $candidates += "$env:LOCALAPPDATA\VerityPDF\verity-pdf.exe"
    $candidates += "$env:ProgramFiles\VerityPDF\VerityPDF.exe"
    $candidates += "$env:ProgramFiles\VerityPDF\verity-pdf.exe"
    return $candidates | Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}

function Assert-PdfAssociation {
    $associations = Get-ChildItem Registry::HKEY_CLASSES_ROOT -ErrorAction SilentlyContinue |
        Where-Object { $_.PSChildName -match 'VerityPDF|verity-pdf' }
    $pdfOpenCommands = Get-ChildItem "Registry::HKEY_CLASSES_ROOT\.pdf\OpenWithProgids" `
        -ErrorAction SilentlyContinue
    if (-not $associations -and -not $pdfOpenCommands) {
        throw "No VerityPDF PDF file association was registered."
    }
}

function Test-InstalledApp {
    param([string]$Label)
    $executable = Find-InstalledExecutable
    if (-not $executable) { throw "$Label did not install the application executable." }
    Assert-PdfAssociation
    & (Join-Path $PSScriptRoot "smoke-windows-app.ps1") `
        -Executable $executable -Pdf $pdfPath `
        -ArtifactDirectory $artifactPath -Label $Label
}

function Remove-NsisInstall {
    $entry = Get-VerityInstall
    if (-not $entry -or -not $entry.UninstallString) { return }
    $command = $entry.UninstallString.Trim('"')
    $process = Start-Process -FilePath $command -ArgumentList "/S" -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "The NSIS uninstaller failed with exit code $($process.ExitCode)."
    }
}

try {
    if ($PreviousMsi -and (Test-Path -LiteralPath $PreviousMsi)) {
        Invoke-Msi @("/i", (Resolve-Path $PreviousMsi).Path, "/qn", "/norestart")
        Test-InstalledApp "msi-previous"
    }
    Invoke-Msi @("/i", $msiPath, "/qn", "/norestart")
    Test-InstalledApp "msi-current"
    Invoke-Msi @("/x", $msiPath, "/qn", "/norestart")
    if (Find-InstalledExecutable) { throw "The MSI uninstall left the app installed." }

    if ($PreviousNsis -and (Test-Path -LiteralPath $PreviousNsis)) {
        $previous = Start-Process -FilePath (Resolve-Path $PreviousNsis).Path `
            -ArgumentList "/S" -Wait -PassThru
        if ($previous.ExitCode -ne 0) { throw "Previous NSIS install failed." }
        Test-InstalledApp "nsis-previous"
    }
    $current = Start-Process -FilePath $nsisPath -ArgumentList "/S" -Wait -PassThru
    if ($current.ExitCode -ne 0) { throw "Current NSIS install failed." }
    Test-InstalledApp "nsis-current"
    Remove-NsisInstall
    if (Find-InstalledExecutable) { throw "The NSIS uninstall left the app installed." }
}
finally {
    try { Invoke-Msi @("/x", $msiPath, "/qn", "/norestart") } catch {}
    try { Remove-NsisInstall } catch {}
}
