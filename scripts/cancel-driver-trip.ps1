$baseUrl = 'https://pickup-backend-engine-v2.onrender.com'
$driverId = 'e7eYigIsoZRjXxi4HJqrJXGXuHk2'

try {
    $res = Invoke-RestMethod -Uri "$baseUrl/trips/active/driver/$driverId" -Method GET
    if ($res.trip) {
        Write-Host "Found trip $($res.trip.id)"
        $body = @{ customerId = $res.trip.customerId; reason = "Admin cancel" } | ConvertTo-Json
        $cancelRes = Invoke-RestMethod -Uri "$baseUrl/trips/$($res.trip.id)/cancel" -Method Post -Body $body -ContentType 'application/json'
        Write-Host "Cancelled trip"
    } else {
        Write-Host "No active trip for driver"
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
