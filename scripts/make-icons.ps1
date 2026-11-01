$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'extension\icons'
foreach ($iconSize in @(32, 128)) {
  $bitmap = New-Object System.Drawing.Bitmap($iconSize, $iconSize)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(179, 41, 45))
  $graphics.FillEllipse($brush, 1, 1, ($iconSize - 2), ($iconSize - 2))
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, ($iconSize / 32))
  $graphics.DrawEllipse($pen, ($iconSize * 0.12), ($iconSize * 0.12), ($iconSize * 0.76), ($iconSize * 0.76))
  $font = New-Object System.Drawing.Font('Microsoft YaHei', ($iconSize * 0.46), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString([char]0x5E25, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 0, $iconSize, $iconSize)), $format)
  $bitmap.Save((Join-Path $iconRoot "icon$iconSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $format.Dispose()
  $font.Dispose()
  $pen.Dispose()
  $brush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
