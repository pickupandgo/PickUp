# End-to-end smoke test against a locally running Pickup-Go-Core-Engine.
#
# Proves the full customer + driver loop the app has to drive:
#   fare -> driver online -> nearby -> create ride -> driver accepts
#   -> trip lifecycle -> completed
#
# Usage:  powershell -File scripts/smoke-engine.ps1
#         powershell -File scripts/smoke-engine.ps1 -BaseUrl https://your-deploy.example.com

param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$DriverId = "D1",
  [string]$CustomerId = "C-smoke-test"
)

$ErrorActionPreference = "Stop"
$step = 0

function Show($label, $data) {
  $script:step++
  Write-Host ""
  Write-Host "[$script:step] $label" -ForegroundColor Cyan
  ($data | ConvertTo-Json -Depth 6 -Compress)
}

function Post($path, $body) {
  $json = if ($null -eq $body) { "{}" } else { $body | ConvertTo-Json -Depth 6 }
  Invoke-RestMethod -Method Post -Uri "$BaseUrl$path" -Body $json -ContentType "application/json" -TimeoutSec 15
}

function Patch($path, $body) {
  Invoke-RestMethod -Method Patch -Uri "$BaseUrl$path" -Body ($body | ConvertTo-Json -Depth 6) -ContentType "application/json" -TimeoutSec 15
}

function Get($path) {
  Invoke-RestMethod -Method Get -Uri "$BaseUrl$path" -TimeoutSec 15
}

# Jodhpur, matching the coordinates the engine's own comments reference.
$pickup = @{ latitude = 26.2389; longitude = 73.0243; address = "Sardarpura, Jodhpur" }
$drop   = @{ latitude = 26.2700; longitude = 73.0100; address = "Shastri Nagar, Jodhpur" }

Write-Host "Engine: $BaseUrl" -ForegroundColor Yellow

Show "Fare estimate (25kg)" (Get "/fare/estimate?pickupLat=$($pickup.latitude)&pickupLng=$($pickup.longitude)&dropLat=$($drop.latitude)&dropLng=$($drop.longitude)&weight=25")

# A driver only becomes discoverable after location + availability + a heartbeat.
Show "Driver location"     (Patch "/drivers/$DriverId/location" @{ latitude = 26.2395; longitude = 73.0250 })
Show "Driver available"    (Patch "/drivers/$DriverId/availability" @{ isAvailable = $true })
Show "Driver heartbeat"    (Get "/ride-requests/$DriverId")   # refreshes lastSeen
Show "Nearby drivers"      (Get "/drivers/nearby?lat=$($pickup.latitude)&lng=$($pickup.longitude)&radius=20")

$ride = Post "/rides" @{
  customerId  = $CustomerId
  driverId    = $DriverId
  pickup      = $pickup
  drop        = $drop
  vehicleType = "Mini Truck"
  weight      = 25
}
Show "Ride created (note the OTP)" $ride
$rideId = $ride.ride.id
$otp    = $ride.ride.otp

Show "Driver sees request"  (Get "/ride-requests/$DriverId")
Show "Driver accepts"       (Post "/rides/$rideId/accept" @{ driverId = $DriverId })
Show "Ride status"          (Get "/rides/$rideId")

$tripRes = Get "/rides/$rideId/trip"
Show "Trip created" $tripRes
$tripId = $tripRes.trip.id

Show "Active trip for customer" (Get "/trips/active/customer/$CustomerId")

Show "Driver arrived"            (Post "/trips/$tripId/arrive" @{ driverId = $DriverId })
Show "Pickup OTP verified"       (Post "/trips/$tripId/pickup/verify-otp" @{ driverId = $DriverId; otp = $otp })
Show "Trip started"              (Post "/trips/$tripId/start" @{ driverId = $DriverId })
Show "Drop started"              (Post "/trips/$tripId/drop/start" @{ driverId = $DriverId })
Show "Drop confirmed"            (Post "/trips/$tripId/drop/confirm" @{ driverId = $DriverId })
Show "Trip completed"            (Post "/trips/$tripId/complete" @{ driverId = $DriverId })

Write-Host ""
Write-Host "PASS - full ride lifecycle works. rideId=$rideId tripId=$tripId otp=$otp" -ForegroundColor Green
