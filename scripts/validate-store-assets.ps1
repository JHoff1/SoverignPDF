[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $PSScriptRoot -ChildPath "..")
)
$assetRoot = Join-Path -Path $repositoryRoot -ChildPath (
    "src-tauri\store\listing-assets"
)
$screenshotRoot = Join-Path -Path $assetRoot -ChildPath "screenshots"
$maximumBytes = 5MB

$requiredAssets = @(
    @{
        Name = "SovereignPDF-Poster-720x1080.png"
        Width = 720
        Height = 1080
        TransparentCorners = $false
    },
    @{
        Name = "SovereignPDF-Poster-1440x2160.png"
        Width = 1440
        Height = 2160
        TransparentCorners = $false
    },
    @{
        Name = "SovereignPDF-BoxArt-1080x1080.png"
        Width = 1080
        Height = 1080
        TransparentCorners = $false
    },
    @{
        Name = "SovereignPDF-BoxArt-2160x2160.png"
        Width = 2160
        Height = 2160
        TransparentCorners = $false
    },
    @{
        Name = "SovereignPDF-AppTile-300x300.png"
        Width = 300
        Height = 300
        TransparentCorners = $true
    },
    @{
        Name = "SovereignPDF-StoreLogo-150x150.png"
        Width = 150
        Height = 150
        TransparentCorners = $true
    },
    @{
        Name = "SovereignPDF-StoreLogo-71x71.png"
        Width = 71
        Height = 71
        TransparentCorners = $true
    }
)

$requiredScreenshots = @(
    "01-document-workspace.png",
    "02-annotation-tools.png",
    "03-search-and-offline-ocr.png",
    "04-about-and-privacy.png"
)

Add-Type -AssemblyName System.Drawing

$results = foreach ($asset in $requiredAssets) {
    $path = Join-Path -Path $assetRoot -ChildPath $asset.Name
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required Store asset is missing: $path"
    }

    $file = Get-Item -LiteralPath $path
    if ($file.Length -ge $maximumBytes) {
        throw (
            "{0} is {1:N2} MB; Store display images must be under 5 MB." -f
            $asset.Name,
            ($file.Length / 1MB)
        )
    }

    $image = [System.Drawing.Bitmap]::FromFile($path)
    try {
        if (
            $image.Width -ne $asset.Width -or
            $image.Height -ne $asset.Height
        ) {
            throw (
                "{0} is {1}x{2}; expected {3}x{4}." -f
                $asset.Name,
                $image.Width,
                $image.Height,
                $asset.Width,
                $asset.Height
            )
        }

        if ($asset.TransparentCorners -and $image.GetPixel(0, 0).A -ne 0) {
            throw "$($asset.Name) must retain transparent outer corners."
        }

        [PSCustomObject]@{
            Asset = $asset.Name
            Dimensions = "{0}x{1}" -f $image.Width, $image.Height
            SizeKB = [math]::Round($file.Length / 1KB, 1)
        }
    }
    finally {
        $image.Dispose()
    }
}

$results | Format-Table -AutoSize

$screenshotResults = foreach ($name in $requiredScreenshots) {
    $path = Join-Path -Path $screenshotRoot -ChildPath $name
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required Store screenshot is missing: $path"
    }

    $file = Get-Item -LiteralPath $path
    if ($file.Length -ge $maximumBytes) {
        throw "$name exceeds the 5 MB Store image limit."
    }

    $image = [System.Drawing.Image]::FromFile($path)
    try {
        if ($image.Width -lt 1366 -or $image.Height -lt 768) {
            throw (
                "{0} is {1}x{2}; desktop Store screenshots must be at " +
                "least 1366x768." -f $name, $image.Width, $image.Height
            )
        }
        [PSCustomObject]@{
            Screenshot = $name
            Dimensions = "{0}x{1}" -f $image.Width, $image.Height
            SizeKB = [math]::Round($file.Length / 1KB, 1)
        }
    }
    finally {
        $image.Dispose()
    }
}

$screenshotResults | Format-Table -AutoSize
Write-Host (
    "Validated {0} Store listing assets and {1} screenshots." -f
    $results.Count,
    $screenshotResults.Count
)
