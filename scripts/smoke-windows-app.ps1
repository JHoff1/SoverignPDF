[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Executable,
    [Parameter(Mandatory)]
    [string]$Pdf,
    [Parameter(Mandatory)]
    [string]$ArtifactDirectory,
    [string]$Label = "windows"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$pdfPath = (Resolve-Path -LiteralPath $Pdf).Path
$artifactPath = [System.IO.Path]::GetFullPath($ArtifactDirectory)
New-Item -ItemType Directory -Path $artifactPath -Force | Out-Null
$readyPath = Join-Path $artifactPath "$Label-ready.txt"
$stdoutPath = Join-Path $artifactPath "$Label-stdout.log"
$stderrPath = Join-Path $artifactPath "$Label-stderr.log"
Remove-Item -LiteralPath $readyPath, $stdoutPath, $stderrPath -Force `
    -ErrorAction SilentlyContinue

$previousMarker = $env:VERITYPDF_SMOKE_READY_FILE
$env:VERITYPDF_SMOKE_READY_FILE = $readyPath
$process = $null

function Normalize-SmokePath {
    param([Parameter(Mandatory)][string]$Path)
    $normalized = [System.IO.Path]::GetFullPath($Path)
    if ($normalized.StartsWith('\\?\')) {
        $normalized = $normalized.Substring(4)
    }
    return $normalized.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
}

try {
    $process = Start-Process -FilePath $executablePath `
        -ArgumentList ('"{0}"' -f $pdfPath) `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        $process.Refresh()
        if ($process.HasExited) {
            throw "$Label exited before it reported a loaded PDF."
        }
        if (Test-Path -LiteralPath $readyPath) {
            $openedPath = (Get-Content -LiteralPath $readyPath -Raw).Trim()
            if ((Normalize-SmokePath $openedPath).Equals(
                (Normalize-SmokePath $pdfPath),
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
                Write-Host "$Label opened $(Split-Path $pdfPath -Leaf)."
                return
            }
        }
        Start-Sleep -Milliseconds 500
    }
    throw "$Label did not report a loaded PDF within 60 seconds."
}
finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(5000) | Out-Null
    }
    # WebView applications may briefly leave a secondary process alive after
    # the main window exits. Ensure installer upgrade/uninstall tests never
    # race a locked application binary on disposable CI runners.
    $processName = [System.IO.Path]::GetFileNameWithoutExtension($executablePath)
    Get-Process -Name $processName -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    $env:VERITYPDF_SMOKE_READY_FILE = $previousMarker
    if ($process -and $process.HasExited -and $process.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $stderrPath) {
            Get-Content -LiteralPath $stderrPath | Write-Host
        }
    }
}
