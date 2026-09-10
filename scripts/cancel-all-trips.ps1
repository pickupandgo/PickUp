# Cancel all active trips on the Pickup-Go-Core-Engine.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/cancel-all-trips.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/cancel-all-trips.ps1 -BaseUrl https://pickup-go-core-engine.onrender.com
#
# The script scans all known customer IDs for active trips and cancels them.

param(
  [string]$BaseUrl = "https://pickup-go-core-engine.onrender.com",
  [string]$CancelReason = "Admin force cancel"
)

$ErrorActionPreference = "Continue"

# ─── Add more customer IDs here as needed ────────────────────────────────────
$customerIds = @(
    "C-smoke-test", "C1", "C2", "C3",
    "customer-1", "customer-2", "customer-3",
    "CUST001", "CUST-001", "CUST-002",
    "user1", "user-1", "user-2",
    "C-test", "C-demo", "demo", "test-customer",
    "C-001", "C-002", "C-003"
)

Write-Host ""
Write-Host "=== CANCEL ALL ACTIVE TRIPS ===" -ForegroundColor Magenta
Write-Host "Engine : $BaseUrl" -ForegroundColor Yellow
Write-Host "Reason : $CancelReason" -ForegroundColor Yellow
Write-Host ""

$found = 0
$cancelled = 0
$failed = 0

Write-Host "--- Scanning $($customerIds.Count) customer IDs for active trips ---" -ForegroundColor Cyan

foreach ($cid in $customerIds) {
    try {
        $res = Invoke-RestMethod -Uri "$BaseUrl/trips/active/customer/$cid" `
            -Method GET -TimeoutSec 10 -ErrorAction Stop
        if ($null -ne $res.trip) {
            $found++
            $trip = $res.trip
            Write-Host "[FOUND] customer=$cid | tripId=$($trip.id) | status=$($trip.status)" -ForegroundColor Green
            try {
                $body = @{ customerId = $trip.customerId; reason = $CancelReason } | ConvertTo-Json
                $cancelRes = Invoke-RestMethod -Method Post `
                    -Uri "$BaseUrl/trips/$($trip.id)/cancel" `
                    -Body $body -ContentType "application/json" `
                    -TimeoutSec 10 -ErrorAction Stop
                $cancelled++
                Write-Host "  [CANCELLED] -> new status: $($cancelRes.trip.status)" -ForegroundColor Green
            } catch {
                $failed++
                Write-Host "  [ERR] Cancel failed: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    } catch {
        # No active trip or connection error — skip silently
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Magenta
Write-Host "Found    : $found active trip(s)" -ForegroundColor Cyan
Write-Host "Cancelled: $cancelled" -ForegroundColor Green
if ($failed -gt 0) {
    Write-Host "Failed   : $failed" -ForegroundColor Red
}
if ($found -eq 0) {
    Write-Host "[INFO] Engine par koi active trip nahi thi." -ForegroundColor Yellow
    Write-Host "[INFO] Engine in-memory hai — Render restart par sab wipe hota hai." -ForegroundColor Yellow
}
Write-Host ""
