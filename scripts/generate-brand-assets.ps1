[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$markPath = Join-Path $root "branding\verity-mark.png"
$iconRoot = Join-Path $root "src-tauri\icons"
$listingRoot = Join-Path $root "src-tauri\store\listing-assets"
$installerRoot = Join-Path $root "src-tauri\installer"
$publicRoot = Join-Path $root "public"
$websitePublicRoot = Join-Path $root "website\public"

if (-not (Test-Path -LiteralPath $markPath)) {
    throw "The VerityPDF master mark is missing: $markPath"
}

function New-Canvas {
    param([int]$Width, [int]$Height, [bool]$Transparent = $false)
    $format = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, $format)
    if (-not $Transparent) {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
                [System.Drawing.Rectangle]::new(0, 0, $Width, $Height),
                [System.Drawing.Color]::FromArgb(255, 12, 15, 20),
                [System.Drawing.Color]::FromArgb(255, 30, 37, 49),
                35
            )
            try {
                $graphics.FillRectangle($background, 0, 0, $Width, $Height)
            }
            finally {
                $background.Dispose()
            }
        }
        finally {
            $graphics.Dispose()
        }
    }
    return $bitmap
}

function Initialize-Graphics {
    param([System.Drawing.Bitmap]$Bitmap)
    $graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    return $graphics
}

function Draw-CenteredImage {
    param(
        [System.Drawing.Graphics]$Graphics,
        [System.Drawing.Image]$Image,
        [int]$CenterX,
        [int]$Y,
        [int]$Width,
        [int]$Height
    )
    $x = $CenterX - [math]::Floor($Width / 2)
    $Graphics.DrawImage($Image, $x, $Y, $Width, $Height)
}

function Draw-CenteredText {
    param(
        [System.Drawing.Graphics]$Graphics,
        [string]$Text,
        [float]$FontSize,
        [int]$CenterX,
        [int]$Y,
        [System.Drawing.Color]$Color,
        [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular
    )
    $font = [System.Drawing.Font]::new("Segoe UI", $FontSize, $Style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = [System.Drawing.SolidBrush]::new($Color)
    try {
        $size = $Graphics.MeasureString($Text, $font)
        $Graphics.DrawString($Text, $font, $brush, $CenterX - ($size.Width / 2), $Y)
    }
    finally {
        $brush.Dispose()
        $font.Dispose()
    }
}

function Save-Png {
    param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Save-Bmp {
    param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
}

function New-TransparentMark {
    param([int]$Size, [string]$Path, [System.Drawing.Image]$Mark)
    $bitmap = New-Canvas -Width $Size -Height $Size -Transparent $true
    $graphics = Initialize-Graphics $bitmap
    try {
        $padding = [math]::Max(2, [math]::Round($Size * 0.08))
        $drawSize = $Size - (2 * $padding)
        $graphics.DrawImage($Mark, $padding, $padding, $drawSize, $drawSize)
        Save-Png $bitmap $Path
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function New-StoreArtwork {
    param(
        [int]$Width,
        [int]$Height,
        [string]$Path,
        [System.Drawing.Image]$Mark
    )
    $bitmap = New-Canvas -Width $Width -Height $Height
    $graphics = Initialize-Graphics $bitmap
    try {
        $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(36, 237, 91, 43))
        try {
            $graphics.FillEllipse($accent, -($Width * 0.28), $Height * 0.58, $Width * 0.9, $Width * 0.9)
            $graphics.FillEllipse($accent, $Width * 0.55, -($Width * 0.25), $Width * 0.62, $Width * 0.62)
        }
        finally {
            $accent.Dispose()
        }

        $markSize = [math]::Round([math]::Min($Width * 0.64, $Height * 0.48))
        $markY = [math]::Round($Height * 0.12)
        Draw-CenteredImage $graphics $Mark ([math]::Round($Width / 2)) $markY $markSize $markSize

        $nameSize = [math]::Round([math]::Min($Width * 0.096, $Height * 0.072))
        $nameY = [math]::Round($markY + $markSize + ($Height * 0.035))
        Draw-CenteredText $graphics "VerityPDF" $nameSize ([math]::Round($Width / 2)) $nameY `
            ([System.Drawing.Color]::FromArgb(255, 247, 248, 250)) ([System.Drawing.FontStyle]::Bold)

        $taglineSize = [math]::Round([math]::Min($Width * 0.028, $Height * 0.021))
        Draw-CenteredText $graphics "PRIVATE PDF EDITING, ON YOUR DEVICE" $taglineSize `
            ([math]::Round($Width / 2)) ([math]::Round($nameY + ($nameSize * 1.5))) `
            ([System.Drawing.Color]::FromArgb(255, 196, 201, 211))

        Save-Png $bitmap $Path
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function New-InstallerImage {
    param(
        [int]$Width,
        [int]$Height,
        [string]$Path,
        [System.Drawing.Image]$Mark,
        [bool]$Tall = $false
    )
    $bitmap = New-Canvas -Width $Width -Height $Height
    $graphics = Initialize-Graphics $bitmap
    try {
        if ($Tall) {
            $markSize = [math]::Round([math]::Min($Width * 0.72, $Height * 0.36))
            Draw-CenteredImage $graphics $Mark ([math]::Round($Width / 2)) ([math]::Round($Height * 0.12)) $markSize $markSize
            Draw-CenteredText $graphics "VerityPDF" ([math]::Round($Width * 0.13)) `
                ([math]::Round($Width / 2)) ([math]::Round($Height * 0.54)) `
                ([System.Drawing.Color]::White) ([System.Drawing.FontStyle]::Bold)
            Draw-CenteredText $graphics "Private. Local. Free." ([math]::Round($Width * 0.06)) `
                ([math]::Round($Width / 2)) ([math]::Round($Height * 0.67)) `
                ([System.Drawing.Color]::FromArgb(255, 205, 209, 218))
        }
        else {
            $markSize = [math]::Round($Height * 0.72)
            $graphics.DrawImage($Mark, [math]::Round($Height * 0.18), [math]::Round($Height * 0.14), $markSize, $markSize)
            $fontSize = [math]::Round($Height * 0.31)
            $font = [System.Drawing.Font]::new("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
            $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
            try {
                $graphics.DrawString("VerityPDF", $font, $brush, [math]::Round($Height * 1.05), [math]::Round($Height * 0.25))
            }
            finally {
                $brush.Dispose()
                $font.Dispose()
            }
        }
        Save-Bmp $bitmap $Path
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$mark = [System.Drawing.Image]::FromFile($markPath)
try {
    New-TransparentMark 512 (Join-Path $iconRoot "app-icon.png") $mark
    New-TransparentMark 512 (Join-Path $publicRoot "app-icon.png") $mark
    New-TransparentMark 512 (Join-Path $websitePublicRoot "app-icon.png") $mark
    Copy-Item -LiteralPath (Join-Path $iconRoot "app-icon.svg") `
        -Destination (Join-Path $websitePublicRoot "favicon.svg") -Force

    New-TransparentMark 300 (Join-Path $listingRoot "VerityPDF-AppTile-300x300.png") $mark
    New-TransparentMark 150 (Join-Path $listingRoot "VerityPDF-StoreLogo-150x150.png") $mark
    New-TransparentMark 71 (Join-Path $listingRoot "VerityPDF-StoreLogo-71x71.png") $mark

    New-StoreArtwork 720 1080 (Join-Path $listingRoot "VerityPDF-Poster-720x1080.png") $mark
    New-StoreArtwork 1440 2160 (Join-Path $listingRoot "VerityPDF-Poster-1440x2160.png") $mark
    New-StoreArtwork 1080 1080 (Join-Path $listingRoot "VerityPDF-BoxArt-1080x1080.png") $mark
    New-StoreArtwork 2160 2160 (Join-Path $listingRoot "VerityPDF-BoxArt-2160x2160.png") $mark
    New-StoreArtwork 1792 930 (Join-Path $websitePublicRoot "og.png") $mark

    New-InstallerImage 150 57 (Join-Path $installerRoot "nsis-header.bmp") $mark
    New-InstallerImage 164 314 (Join-Path $installerRoot "nsis-sidebar.bmp") $mark $true
    New-InstallerImage 493 58 (Join-Path $installerRoot "wix-banner.bmp") $mark
    New-InstallerImage 493 312 (Join-Path $installerRoot "wix-dialog.bmp") $mark $true
}
finally {
    $mark.Dispose()
}

Write-Host "Generated VerityPDF application, installer, Store, and website assets."
