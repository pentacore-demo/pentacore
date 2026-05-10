const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const expressSession = require("express-session");
const admin = require('firebase-admin');
const https = require("https");
const dealerRouter = express.Router();

// 👉 PUT YOUR DOWNLOADED FILE HERE
const serviceAccount = require('./fir-c1b0e-firebase-adminsdk-fbsvc-ba4d8926e8.json');

// 🔥 Firebase Admin INIT (safe + correct)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),

        // ⚠️ MUST MATCH serviceAccount project_id
        databaseURL: "https://fir-c1b0e-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}

// Database reference (same name so rest code works)
const db = admin.database();


// Middleware for session management
dealerRouter.use(
  expressSession({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true
  })
);

// Middleware to parse incoming form data
dealerRouter.use(bodyParser.urlencoded({ extended: true }));



function keepServerAlive() {
  const options = {
    hostname: "jladhesive.in",
    path: "/dealer/login",
    method: "GET",
  };

  const req = https.request(options, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      const redirectUrl = new URL(res.headers.location);

      // Follow the redirect
      const redirectOptions = {
        hostname: redirectUrl.hostname,
        path: redirectUrl.pathname,
        method: "GET",
      };

      const redirectReq = https.request(redirectOptions, () => {
        // Final redirect handled successfully
      });

      redirectReq.on("error", (err) => {
        console.error(`Error following redirect: ${err.message}`);
      });

      redirectReq.end();
    }
  });

  req.on("error", (error) => {
    console.error(`Keep-alive ping error: ${error.message}`);
  });

  req.end();
}

// Ping the server every 12 minutes
setInterval(keepServerAlive, 12 * 60 * 1000);
// Serve the login page
dealerRouter.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "dealer-login.html"));
});

// Handle login form submission
dealerRouter.post("/login", async (req, res) => {
  const { userId, password } = req.body;

  try {
    // Reference to the 'dealers' node in Firebase with userId
    const dealerRef = ref(db, "dealers/" + userId);
    const snapshot = await get(dealerRef);

    if (snapshot.exists()) {
      const dealerData = snapshot.val();
      
      if (dealerData.password === password) {
        // Save the session to keep the user logged in
        req.session.isLoggedIn = true;
        req.session.userId = userId;

        // Redirect to the dealer dashboard
        return res.redirect("/dealer/dealer-dashboard");
      } else {
        // Incorrect password
        return res.status(401).send("Invalid User ID or password.");
      }
    } else {
      // Dealer not found
      return res.status(401).send("Invalid User ID or password.");
    }
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).send("Internal server error.");
  }
});

// Dealer dashboard route (only accessible when logged in)
dealerRouter.get("/dealer-dashboard", (req, res) => {
  if (req.session.isLoggedIn) {
    // Show the dealer dashboard page
    res.sendFile(path.join(__dirname, "views", "dealer-dashboard.html"));
  } else {
    // Redirect to login page if not authenticated
    res.redirect("/dealer/login");
  }
});

// Route to get QR code details based on the QR code input
dealerRouter.get("/get-qr-details/:qrCode", async (req, res) => {
    const qrCode = req.params.qrCode;
  
    try {
      // Reference to the Firebase 'coupons' node
      const couponRef = ref(db, 'coupons');
      const snapshot = await get(couponRef);
  
      if (!snapshot.exists()) {
        return res.status(500).json({ success: false, message: "Error reading data." });
      }
  
      const couponData = snapshot.val();
  
       // Find the QR code details
    const qrCodeDetails = Object.values(couponData).find(item => item.qrCode === qrCode);

    if (qrCodeDetails) {
      return res.json({
        success: true,
        qrCode: qrCodeDetails.qrCode,
        scannedBy: qrCodeDetails.fullName,
        mobileNumber: qrCodeDetails.mobileNumber,
        qrBatch: qrCodeDetails.qrBatch || "N/A",  // Fallback for qrBatch if not found
        scanDate: qrCodeDetails.dateScanned,
        transactionAmount: qrCodeDetails.points
      });
    } else {
      return res.json({ success: false });
    }

  } catch (err) {
    console.error("Error fetching coupon data:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch QR code details." });
  }
});

module.exports = dealerRouter;



