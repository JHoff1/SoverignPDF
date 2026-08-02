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
    param([string[]]$Arguments, [string]$Label = "msi")
    $logPath = Join-Path $artifactPath "$Label-msiexec.log"
    $loggedArguments = @($Arguments) + @("/l*v", $logPath)
    $process = Start-Process msiexec.exe -ArgumentList $loggedArguments -Wait -PassThru
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
    ) | Where-Object {
        $_.PSObject.Properties["DisplayName"] -and
        $_.DisplayName -like "VerityPDF*"
    } | Sort-Object {
        $displayVersion = if ($_.PSObject.Properties["DisplayVersion"]) {
            $_.DisplayVersion
        } else {
            "0.0.0"
        }
        [version]($displayVersion -replace '[^0-9.]', '')
    } -Descending
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

function Assert-AppRemoved {
    param([string]$Label)
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        if (-not (Find-InstalledExecutable)) { return }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    $remaining = Find-InstalledExecutable
    throw "$Label left the application executable at $remaining."
}

try {
    if ($PreviousMsi -and (Test-Path -LiteralPath $PreviousMsi)) {
        Invoke-Msi -Label "previous-install" -Arguments @("/i", (Resolve-Path $PreviousMsi).Path, "/qn", "/norestart")
        Test-InstalledApp "msi-previous"
    }
    Invoke-Msi -Label "current-install" -Arguments @("/i", $msiPath, "/qn", "/norestart")
    Test-InstalledApp "msi-current"
    Invoke-Msi -Label "current-uninstall" -Arguments @("/x", $msiPath, "/qn", "/norestart")
    Assert-AppRemoved "The MSI uninstall"

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
    Assert-AppRemoved "The NSIS uninstall"
}
finally {
    try { Invoke-Msi -Label "cleanup-uninstall" -Arguments @("/x", $msiPath, "/qn", "/norestart") } catch {}
    try { Remove-NsisInstall } catch {}
}
