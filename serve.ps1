# Servidor estático mínimo para desarrollo en Windows sin Node ni Python.
#
#   powershell -ExecutionPolicy Bypass -File serve.ps1
#   powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8080
#
# Hace falta un servidor HTTP porque el proyecto usa módulos ES: abrir
# index.html con doble clic (file://) los bloquea por las reglas de CORS.

param(
  [int]$Port = 8000,
  [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.md'   = 'text/markdown; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Host "No se pudo abrir el puerto $Port. Probá otro: -Port 8080" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  Math Particle Hands" -ForegroundColor Cyan
Write-Host "  Sirviendo $Root"
Write-Host "  Abrí  http://localhost:$Port/" -ForegroundColor Green
Write-Host "  Tests http://localhost:$Port/tests/"
Write-Host "  Ctrl+C para detener."
Write-Host ""

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

    $path = Join-Path $Root $rel
    # No permitir salir de la carpeta del proyecto
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.OutputStream.Close()
      continue
    }
    if ((Test-Path $full) -and ((Get-Item $full).PSIsContainer)) {
      $full = Join-Path $full 'index.html'
    }

    if (Test-Path $full) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ct = $types[$ext]
      if (-not $ct) { $ct = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ctx.Response.ContentType = $ct
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $b = [System.Text.Encoding]::UTF8.GetBytes("404 - no encontrado: $rel")
      $ctx.Response.OutputStream.Write($b, 0, $b.Length)
    }
    $ctx.Response.OutputStream.Close()
  } catch {
    Write-Host "Error: $_" -ForegroundColor Yellow
  }
}
