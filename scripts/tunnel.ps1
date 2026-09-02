# Publishes the local Pickup-Go-Core-Engine over the internet through a
# Cloudflare Quick Tunnel, then rewrites EXPO_PUBLIC_API_BASE_URL in every
# .env this repo cares about so both Expo apps pick up the new URL.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/tunnel.ps1
#
# Quick tunnels are anonymous, generate a fresh subdomain every restart, and
# require no account. Ctrl+C to stop.

param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

$cloudflared = @(
  "$env:ProgramFiles\cloudflared\cloudflared.exe",
  "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $cloudflared) { $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source }
if (-not $cloudflared) {
  Write-Host "cloudflared is not installed. Install it with:" -ForegroundColor Red
  Write-Host "  winget install --id Cloudflare.cloudflared" -ForegroundColor Yellow
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
$envFiles = @((Join-Path $root '.env'), (Join-Path $root 'pickup-driver' '.env')) | Where-Object { Test-Path $_ }

Write-Host "Starting Cloudflare Quick Tunnel to http://localhost:$Port ..." -ForegroundColor Cyan

$logPath = Join-Path $env:TEMP "pickup-cloudflared-$(Get-Random).log"
$proc = Start-Process -FilePath $cloudflared -ArgumentList @(
  'tunnel', '--url', "http://localhost:$Port", '--no-autoupdate'
) -RedirectStandardOutput $logPath -RedirectStandardError $logPath -NoNewWindow -PassThru

try {
  $publicUrl = $null
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline -and -not $publicUrl) {
    Start-Sleep -Milliseconds 800
    if (Test-Path $logPath) {
      $match = Get-Content $logPath -Raw -ErrorAction SilentlyContinue |
        Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches
      if ($match) { $publicUrl = $match.Matches[0].Value }
    }
  }

  if (-not $publicUrl) {
    Write-Host "Tunnel did not report a URL within 60 s. See $logPath for details." -ForegroundColor Red
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    exit 1
  }

  Write-Host "`nPublic URL: $publicUrl" -ForegroundColor Green

  foreach ($f in $envFiles) {
    $updated = (Get-Content $f) -replace `
      '^EXPO_PUBLIC_API_BASE_URL=.*', ("EXPO_PUBLIC_API_BASE_URL=" + $publicUrl)
    Set-Content -Path $f -Value $updated -Encoding utf8
    Write-Host "  updated $f" -ForegroundColor DarkGray
  }

  # Confirm the tunnel actually reaches the engine before you send it to friends.
  try {
    $probe = Invoke-RestMethod "$publicUrl/drivers" -TimeoutSec 20
    Write-Host ("Engine reachable through tunnel. Drivers known: {0}" -f $probe.drivers.Count) -ForegroundColor Green
  } catch {
    Write-Host "Tunnel is up but the engine did not respond. Is it running (npm run start:dev in engine/)?" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Restart both Expo apps with a cache clear so they pick up the new URL:" -ForegroundColor Yellow
  Write-Host "  Customer:  npm start -- --tunnel -c" -ForegroundColor Yellow
  Write-Host "  Driver:    cd pickup-driver ; npm start -- --tunnel -c" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Ctrl+C to stop the tunnel."

  Wait-Process -Id $proc.Id
} finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  if (Test-Path $logPath) { Remove-Item $logPath -Force -ErrorAction SilentlyContinue }
}
