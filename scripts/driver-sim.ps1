# Keeps a fake driver online so the app can find someone to book.
#
# The engine only returns a driver from /drivers/nearby when they are marked
# available AND have pinged within the last 60s. Polling /ride-requests/:id is
# what refreshes that heartbeat, so this script loops on it.
#
# It also auto-accepts incoming ride requests, then walks the trip forward so
# you can watch the whole customer flow without a driver app.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/driver-sim.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/driver-sim.ps1 -AutoAdvance
#
#   -AutoAdvance   also drives arrive -> pickup -> transit -> delivered -> completed
#   Ctrl+C to stop.

param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$DriverId = "D1",
  [double]$Latitude = 26.2395,
  [double]$Longitude = 73.0250,
  [switch]$AutoAdvance
)

$ErrorActionPreference = "Stop"

function Post($path, $body) {
  $json = if ($null -eq $body) { "{}" } else { $body | ConvertTo-Json -Depth 6 }
  Invoke-RestMethod -Method Post -Uri "$BaseUrl$path" -Body $json -ContentType "application/json" -TimeoutSec 15
}
function Patch($path, $body) {
  Invoke-RestMethod -Method Patch -Uri "$BaseUrl$path" -Body ($body | ConvertTo-Json -Depth 6) -ContentType "application/json" -TimeoutSec 15
}
function Get($path) { Invoke-RestMethod -Uri "$BaseUrl$path" -TimeoutSec 15 }

Write-Host "Driver simulator: $DriverId @ $Latitude,$Longitude" -ForegroundColor Yellow
Write-Host "Engine: $BaseUrl" -ForegroundColor Yellow

try {
  Patch "/drivers/$DriverId/location" @{ latitude = $Latitude; longitude = $Longitude } | Out-Null
  Patch "/drivers/$DriverId/availability" @{ isAvailable = $true } | Out-Null
  Write-Host "Driver is online. Heartbeat every 3s. Ctrl+C to stop." -ForegroundColor Green
} catch {
  Write-Host "Could not bring driver online. Is the engine running on $BaseUrl ?" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

$handled = @{}

while ($true) {
  try {
    # This call is the heartbeat as well as the request inbox.
    $inbox = Get "/ride-requests/$DriverId"

    foreach ($req in $inbox.requests) {
      if ($handled.ContainsKey($req.rideId)) { continue }
      $handled[$req.rideId] = $true

      Write-Host ""
      Write-Host ("Ride " + $req.rideId + " requested - fare INR " + $req.fare + ", " + $req.weight + "kg") -ForegroundColor Cyan
      Write-Host ("  pickup: " + $req.pickup.address)
      Write-Host ("  drop:   " + $req.drop.address)

      Post "/rides/$($req.rideId)/accept" @{ driverId = $DriverId } | Out-Null
      Write-Host "  ACCEPTED" -ForegroundColor Green

      $tripRes = Get "/rides/$($req.rideId)/trip"
      $tripId = $tripRes.trip.id
      $otp = $tripRes.trip.otp
      Write-Host ("  trip " + $tripId + " created, status " + $tripRes.trip.status + ", OTP " + $otp) -ForegroundColor Green

      if ($AutoAdvance) {
        Write-Host "  auto-advancing trip..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 5
        Post "/trips/$tripId/arrive" @{ driverId = $DriverId } | Out-Null
        Write-Host "  DRIVER_ARRIVED" -ForegroundColor Green

        Start-Sleep -Seconds 5
        Post "/trips/$tripId/pickup/verify-otp" @{ driverId = $DriverId; otp = $otp } | Out-Null
        Write-Host "  PICKUP_VERIFIED" -ForegroundColor Green

        Start-Sleep -Seconds 3
        Post "/trips/$tripId/start" @{ driverId = $DriverId } | Out-Null
        Write-Host "  IN_TRANSIT" -ForegroundColor Green

        Start-Sleep -Seconds 8
        Post "/trips/$tripId/drop/start" @{ driverId = $DriverId } | Out-Null
        Write-Host "  DROP_PROGRESS" -ForegroundColor Green

        Start-Sleep -Seconds 4
        Post "/trips/$tripId/drop/confirm" @{ driverId = $DriverId } | Out-Null
        Write-Host "  DELIVERED" -ForegroundColor Green

        Start-Sleep -Seconds 3
        Post "/trips/$tripId/complete" @{ driverId = $DriverId } | Out-Null
        Write-Host "  COMPLETED" -ForegroundColor Green

        # Completing frees the driver; make them bookable again.
        Patch "/drivers/$DriverId/availability" @{ isAvailable = $true } | Out-Null
        Write-Host "  driver available again" -ForegroundColor DarkGray
      } else {
        Write-Host "  Run trip steps manually, or restart with -AutoAdvance" -ForegroundColor DarkGray
      }
    }
  } catch {
    Write-Host ("heartbeat error: " + $_.Exception.Message) -ForegroundColor DarkYellow
  }

  Start-Sleep -Seconds 3
}
