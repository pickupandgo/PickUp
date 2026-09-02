# Verifies which Google Maps Platform APIs the key in .env can actually use.
#
# Checks the three endpoints the app depends on:
#   1. Places API (New) - autocomplete
#   2. Places API (New) - place details
#   3. Geocoding API    - reverse geocode
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/check-maps-key.ps1

$ErrorActionPreference = 'Continue'

$line = (Get-Content .env | Select-String '^EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=')
$key = ($line -replace '^EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=', '').Trim()

if (-not $key) { Write-Host "No key found in .env" -ForegroundColor Red; exit 1 }
Write-Host ("Key loaded (" + $key.Length + " chars)") -ForegroundColor Yellow

function ReadError($err) {
  $resp = $err.Exception.Response
  if ($resp) {
    $reader = New-Object IO.StreamReader($resp.GetResponseStream())
    return "HTTP " + [int]$resp.StatusCode + " " + $reader.ReadToEnd()
  }
  return $err.Exception.Message
}

# 1. Autocomplete
Write-Host "`n[1] Places API (New) - autocomplete" -ForegroundColor Cyan
$placeId = $null
try {
  $r = Invoke-RestMethod -Method Post -Uri 'https://places.googleapis.com/v1/places:autocomplete' `
    -Headers @{ 'X-Goog-Api-Key' = $key } -ContentType 'application/json' `
    -Body '{"input":"Shastri Nagar Jodhpur","includedRegionCodes":["in"]}' -TimeoutSec 20
  Write-Host ("  PASS - " + $r.suggestions.Count + " suggestions") -ForegroundColor Green
  $placeId = $r.suggestions[0].placePrediction.placeId
} catch {
  Write-Host ("  FAIL - " + (ReadError $_)) -ForegroundColor Red
}

# 2. Place details
Write-Host "`n[2] Places API (New) - place details" -ForegroundColor Cyan
if ($placeId) {
  try {
    $d = Invoke-RestMethod -Method Get -Uri "https://places.googleapis.com/v1/places/$placeId" `
      -Headers @{ 'X-Goog-Api-Key' = $key; 'X-Goog-FieldMask' = 'id,location,formattedAddress,displayName' } -TimeoutSec 20
    Write-Host ("  PASS - " + $d.formattedAddress) -ForegroundColor Green
    Write-Host ("         " + $d.location.latitude + ", " + $d.location.longitude) -ForegroundColor Green
  } catch {
    Write-Host ("  FAIL - " + (ReadError $_)) -ForegroundColor Red
  }
} else {
  Write-Host "  SKIPPED - no placeId from step 1" -ForegroundColor DarkGray
}

# 3. Directions
Write-Host "`n[3] Directions API - road route" -ForegroundColor Cyan
try {
  $r = Invoke-RestMethod -Uri ("https://maps.googleapis.com/maps/api/directions/json?origin=26.2389,73.0243&destination=26.2665,73.0293&mode=driving&key=" + [uri]::EscapeDataString($key)) -TimeoutSec 20
  if ($r.status -eq 'OK') {
    Write-Host ("  PASS - " + $r.routes[0].legs[0].distance.text + " / " + $r.routes[0].legs[0].duration.text) -ForegroundColor Green
  } else {
    Write-Host ("  FAIL - " + $r.status + " : " + $r.error_message) -ForegroundColor Red
  }
} catch {
  Write-Host ("  FAIL - " + (ReadError $_)) -ForegroundColor Red
}

# 4. Reverse geocoding
Write-Host "`n[4] Geocoding API - reverse geocode" -ForegroundColor Cyan
try {
  $g = Invoke-RestMethod -Uri ("https://maps.googleapis.com/maps/api/geocode/json?latlng=26.2389,73.0243&key=" + [uri]::EscapeDataString($key)) -TimeoutSec 20
  if ($g.status -eq 'OK') {
    Write-Host ("  PASS - " + $g.results[0].formatted_address) -ForegroundColor Green
  } else {
    Write-Host ("  FAIL - " + $g.status + " : " + $g.error_message) -ForegroundColor Red
  }
} catch {
  Write-Host ("  FAIL - " + (ReadError $_)) -ForegroundColor Red
}

Write-Host ""
