const express = require('express');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const axios = require('axios');
const userRouter = express.Router();

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


// Fast2SMS API details
const FAST2SMS_URL = 'https://www.fast2sms.com/dev/bulkV2';
const FAST2SMS_API_KEY = 'haltVXGKcRr1psUDTBv8HQWMkw6YJ3moSOgCn5yEfd79NZi2I0c7FQRq5sgLVJWf3HvbS8ICoMty0Bn4'; // Replace with your Fast2SMS API Key
const SENDER_ID = 'RJHIND';
const TEMPLATE_ID = '161703'; // Replace with your DLT-approved template ID

// Initialize session middleware
userRouter.use(
    session({
        secret: 'your_secret_key',
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: false, // Set to true if using HTTPS
            httpOnly: true,
            // maxAge removed for unlimited session duration
        }
    })
);


// Middleware
userRouter.use(bodyParser.urlencoded({ extended: true }));
userRouter.use(bodyParser.json());
userRouter.use(express.urlencoded({ extended: true }));

// Middleware to check if the user is logged in and active
async function isAuthenticated(req, res, next) {
  if (req.session && req.session.mobileNumber) {
      const mobileNumber = req.session.mobileNumber;

      try {
        // ✅ Firebase Admin correct usage
        const userRef = db.ref(`users/${mobileNumber}`);
        const snapshot = await userRef.get();

        if (snapshot.exists()) {
            const user = snapshot.val();

            if (user.isActive) {
                return next(); // User is active, proceed to the next middleware
            } else {
                return res.status(403).send('User account is deactivated. Please contact support.');
            }
        } else {
            return res.redirect('/user/register'); // Redirect to register page if no user found
        }
      } catch (err) {
          console.error('Error verifying user:', err);
          return res.status(500).send('Internal server error');
      }
  } else {
      res.redirect('/user/'); // Redirect to login if not authenticated
  }
}



// OTP Sending Route
userRouter.post('/send-otp', async (req, res) => {
    const { mobileNumber } = req.body;

    if (!mobileNumber) {
        return res.status(400).send('Mobile number is required.');
    }

    const otp = Math.floor(100000 + Math.random() * 900000); // Generate OTP

    try {
        req.session.otp = otp;
        req.session.mobileNumber = mobileNumber;

        const response = await axios.get(FAST2SMS_URL, {
            params: {
                authorization: FAST2SMS_API_KEY,
                route: 'dlt',
                sender_id: SENDER_ID,
                message: TEMPLATE_ID,
                variables_values: otp,
                numbers: mobileNumber
            }
        });

        if (response.data.return) {
            res.status(200).send('OTP sent successfully.');
        } else {
            res.status(500).send('Failed to send OTP.');
        }
    } catch (err) {
        console.error('Error sending OTP:', err);
        res.status(500).send('Error sending OTP.');
    }
});

// OTP Verification Route
userRouter.post('/verify-otp', (req, res) => {
    const { otp } = req.body;

    if (!otp) {
        return res.status(400).send('OTP is required.');
    }

    if (otp == req.session.otp) {
        req.session.otp = null; // Clear OTP from session
        res.status(200).send('OTP verified successfully.');
    } else {
        res.status(400).send('Invalid OTP. Please try again.');
    }
});

// Default route: Login page
userRouter.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Registration page: Only accessible after login
userRouter.get('/register', async (req, res) => {
  const mobileNumber = req.session.mobileNumber;

  if (!mobileNumber) {
      return res.redirect('/user/');
  }

  try {
      const userRef = db.ref(`users/${mobileNumber}`);
      const snapshot = await userRef.get();

      if (!snapshot.exists()) {
          console.log('User not found in Firebase. Opening registration page.');
          return res.render('register', { mobileNumber });
      }

      const user = snapshot.val();

      if (user.isRegistered) {
          return res.redirect('/user/dashboard');
      }

      res.render('register', { mobileNumber });
  } catch (err) {
      console.error('Error accessing Firebase:', err);
      return res.status(500).send('Error accessing user data');
  }
});


// Registration form submission
userRouter.post('/register', async (req, res) => {
  const { mobileNumber, fullName, dob, userType, address, pinCode, state, city } = req.body;

  try {
      const userRef = db.ref(`users/${mobileNumber}`);
      const snapshot = await userRef.get();

      if (!snapshot.exists()) {
          const newUser = {
              mobileNumber,
              fullName,
              dob,
              userType,
              address,
              pinCode,
              state,
              city,
              walletBalance: 0.0,
              serialNumber: Date.now(),
              status: 'active',
              isRegistered: true,
              isActive: true,
          };

          await userRef.set(newUser);
          console.log('User created and marked as registered');
      } else {
          const user = snapshot.val();
          if (user.isRegistered) {
              return res.redirect('/user/dashboard');
          }

          await userRef.update({
              fullName,
              dob,
              userType,
              address,
              pinCode,
              state,
              city,
              walletBalance: user.walletBalance || 0,
              isRegistered: true,
              isActive: true
          });
      }

      res.redirect('/user/dashboard');
  } catch (err) {
      console.error('Error saving user data:', err);
      return res.status(500).send('Error saving user data');
  }
});


// Dashboard: Protected route
userRouter.get('/dashboard', isAuthenticated, async (req, res) => {

    const mobileNumber = req.session.mobileNumber;

    try {

        // USER DATA
        const userRef = db.ref(`users/${mobileNumber}`);
        const snapshot = await userRef.get();

        if (!snapshot.exists()) {
            return res.status(404).send('User not found');
        }

        const user = snapshot.val();

        if (!user.isRegistered) {
            return res.redirect('/user/register');
        }

        // BANNERS
        const bannersRef = db.ref('banners');
        const bannersSnapshot = await bannersRef.get();

        let banners = [];

        if (bannersSnapshot.exists()) {

            const bannersData = bannersSnapshot.val();

            banners = Object.values(bannersData).map(
                banner => banner.url
            );

        }

        // TOTAL COUPONS SCANNED
        const couponRef = db.ref('coupons');
        const couponSnapshot = await couponRef.get();

        let totalCouponsScanned = 0;

        if (couponSnapshot.exists()) {

            const coupons = couponSnapshot.val();

            const userCoupons = Object.values(coupons).filter(
                coupon => coupon.mobileNumber === mobileNumber
            );

            totalCouponsScanned = userCoupons.length;

        }

        // RENDER DASHBOARD
        res.render('dashboard', {

            userName: user.fullName,
            walletBalance: user.walletBalance,
            banners: banners,
            userData: user,
            totalCouponsScanned

        });

    } catch (err) {

        console.error('Error fetching user or banner data:', err);

        return res.status(500).send('Error reading user data');

    }

});


// Mobile number submission route
userRouter.post('/submit-mobile', async (req, res) => {
    const { mobileNumber } = req.body;

    if (!mobileNumber) {
        return res.status(400).send('Mobile number is required.');
    }

    req.session.mobileNumber = mobileNumber;

    try {
        const userRef = db.ref(`users/${mobileNumber}`);
        const snapshot = await userRef.get();

        if (snapshot.exists()) {
            const user = snapshot.val();
            return res.redirect(user.isRegistered ? '/user/dashboard' : '/user/register');
        }

        const newUser = {
            mobileNumber,
            fullName: '',
            dob: '',
            userType: '',
            address: '',
            pinCode: '',
            state: '',
            city: '',
            walletBalance: 0.0,
            serialNumber: Date.now(),
            status: 'active',
            isRegistered: false,
            isActive: true
        };

        await userRef.set(newUser);
        res.redirect('/user/register');
    } catch (err) {
        res.status(500).send('Error creating user');
    }
});


// Registration form submission (second one)
userRouter.post('/register', async (req, res) => {
    const { mobileNumber, fullName, dob, userType, address, pinCode, state, city } = req.body;

    try {
        const userRef = db.ref(`users/${mobileNumber}`);
        const snapshot = await userRef.get();

        if (!snapshot.exists()) {
            return res.status(404).send('User not found');
        }

        const user = snapshot.val();

        await userRef.update({
            fullName,
            dob,
            userType,
            address,
            pinCode,
            state,
            city,
            walletBalance: user.walletBalance || 0,
            isRegistered: true,
            isActive: true
        });

        res.redirect('/user/dashboard');
    } catch (err) {
        return res.status(500).send('Error saving user data');
    }
});

// QR Code scanning logic
// QR Code scanning page: Protected route
userRouter.get('/scan-qr', isAuthenticated, async (req, res) => {
    const mobileNumber = req.session.mobileNumber;

    try {
        // Fetch user data from Firebase
        const userRef = db.ref(`users/${mobileNumber}`);
        const userSnapshot = await userRef.get();

        if (!userSnapshot.exists()) {
            return res.status(404).send('User not found');
        }

        const user = userSnapshot.val();

  if (user.status !== "active") {

    return res.status(403).send(`

    <!DOCTYPE html>
    <html lang="en">

    <head>

        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <title>Account Disabled</title>

        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

        <style>

            *{
                margin:0;
                padding:0;
                box-sizing:border-box;
            }

            body{
                font-family:'Inter',sans-serif;
                min-height:100vh;
                display:flex;
                justify-content:center;
                align-items:center;
                background:#f6f8fb;
                overflow:hidden;
                padding:20px;
                position:relative;
            }

            .bg{
                position:absolute;
                border-radius:50%;
                filter:blur(90px);
                opacity:.45;
                z-index:0;
            }

            .bg1{
                width:320px;
                height:320px;
                background:#c7d2fe;
                top:-120px;
                left:-120px;
            }

            .bg2{
                width:320px;
                height:320px;
                background:#fecaca;
                bottom:-120px;
                right:-120px;
            }

            .card{
                position:relative;
                z-index:2;
                width:100%;
                max-width:430px;
                background:rgba(255,255,255,0.82);
                backdrop-filter:blur(20px);
                border:1px solid rgba(255,255,255,0.7);
                border-radius:30px;
                padding:40px 30px;
                text-align:center;
                box-shadow:
                    0 20px 40px rgba(15,23,42,0.08),
                    0 4px 10px rgba(15,23,42,0.04);
            }

            .icon{
                width:90px;
                height:90px;
                margin:auto;
                margin-bottom:25px;
                border-radius:24px;
                background:#fee2e2;
                display:flex;
                justify-content:center;
                align-items:center;
                font-size:40px;
            }

            h1{
                font-size:32px;
                color:#0f172a;
                margin-bottom:14px;
            }

            p{
                color:#64748b;
                font-size:15px;
                line-height:1.7;
                margin-bottom:30px;
            }

            .btn{
                display:inline-block;
                padding:14px 24px;
                border-radius:16px;
                background:linear-gradient(135deg,#818cf8,#6366f1);
                color:white;
                text-decoration:none;
                font-weight:600;
                transition:.25s;
                box-shadow:0 10px 20px rgba(99,102,241,.18);
            }

            .btn:hover{
                transform:translateY(-2px);
            }

            @media(max-width:600px){

                .card{
                    padding:32px 22px;
                    border-radius:24px;
                }

                h1{
                    font-size:26px;
                }

            }

        </style>

    </head>

    <body>

        <div class="bg bg1"></div>
        <div class="bg bg2"></div>

        <div class="card">

            <div class="icon">
                🚫
            </div>

            <h1>Account Disabled</h1>

            <p>
                Your account has been disabled by admin.
                QR code scanning is currently blocked for your account.
            </p>

            <a href="/user/dashboard" class="btn">
                Go Back
            </a>

        </div>

    </body>

    </html>

    `);

}

        if (!user.isRegistered) {
            return res.status(403).send('You need to be registered to access this page.');
        }

        // Render the scan QR page if everything is fine
        res.sendFile(path.join(__dirname, 'views', 'scan-qr.html'));
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).send('Error checking user registration.');
    }
});

// QR Code scanning logic (POST request)
userRouter.post('/scan-qr', isAuthenticated, async (req, res) => {
    const qrCode = req.body.qrCode.trim();
    const mobileNumber = req.session.mobileNumber;

    try {
        // Fetch all batches from the database
        const batchRef = db.ref('batches');
        const snapshot = await batchRef.get();

        if (!snapshot.exists()) {
            return res.json({ success: false, message: 'No batches found.' });
        }

        const batches = snapshot.val();
        let qrData = null;
        let qrBatch = '';

        for (const batchId in batches) {
            const batch = batches[batchId];

            const qrCodesArray = Array.isArray(batch.qrCodes)
                ? batch.qrCodes
                : Object.values(batch.qrCodes || {});

            const qr = qrCodesArray.find(qr => qr.code === qrCode);
            if (qr) {
                qrData = qr;
                qrBatch = batchId;
                break;
            }
        }

        if (!qrData) {
            return res.json({ success: false, message: 'QR Code not found.' });
        }

        if (qrData.status === 'Scanned') {
            return res.json({ success: false, message: 'QR Code already scanned.' });
        }

        // Update QR status
        const qrCodesRef = db.ref(`batches/${qrBatch}/qrCodes`);
        const qrCodesSnapshot = await qrCodesRef.get();

        if (qrCodesSnapshot.exists()) {
            const qrCodes = qrCodesSnapshot.val();
            const qrCodeKey = Object.keys(qrCodes).find(key => qrCodes[key].code === qrCode);

            if (qrCodeKey) {
                const qrCodeRef = db.ref(`batches/${qrBatch}/qrCodes/${qrCodeKey}`);
                await qrCodeRef.update({ status: 'Scanned' });
            } else {
                console.error('QR Code key not found.');
            }
        }

        // Get user data
        const userRef = db.ref(`users/${mobileNumber}`);
        const userSnapshot = await userRef.get();

        if (!userSnapshot.exists()) {
            return res.json({ success: false, message: 'User not found.' });
        }

        const user = userSnapshot.val();
 
        // CHECK USER STATUS
if (user.status !== "active") {
    return res.json({
        success: false,
        message: "Your account is inactive."
    });
}
        const points = Number(qrData.points);

        let currentBalance = 0;
        if (user.walletBalance !== undefined) {
            currentBalance = Number(user.walletBalance);
            if (isNaN(currentBalance)) {
                currentBalance = 0;
            }
        }

        const updatedBalance = currentBalance + points;

        // Update wallet
        await userRef.update({ walletBalance: updatedBalance });

        // Save coupon
        const couponId = `${mobileNumber}_${qrCode}_${Date.now()}`;
        const couponRef = db.ref(`coupons/${couponId}`);

        const couponData = {
            mobileNumber,
            fullName: user.fullName,
            qrCode,
            points,
            dateScanned: new Date().toISOString().split('T')[0],
            qrBatch,
            serialNumber: Date.now()
        };

        await couponRef.set(couponData);

        res.json({
            success: true,
            message: 'QR Code scanned successfully!',
            points
        });

    } catch (err) {
        console.error('Error scanning QR:', err);
        res.json({ success: false, message: 'Failed to scan QR code' });
    }
});

// Sample route for handling logout
userRouter.post('/logout', (req, res) => {
    // If using sessions
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Failed to log out');
        }
        res.redirect('/user'); // Redirect to login page after successful logout
    });
});

// Route for QR Apply History Page
userRouter.get('/qr-apply-history', isAuthenticated, async (req, res) => {
    const mobileNumber = req.session.mobileNumber;

    try {
        // Fetch the user's coupon data from Firebase
        const couponRef = db.ref('coupons');
        const snapshot = await couponRef.get();

        if (!snapshot.exists()) {
            return res.json({ success: false, message: 'No coupon history found.' });
        }

        const coupons = snapshot.val();

        // Filter coupons by the logged-in user's mobile number
        let userCoupons = Object.values(coupons).filter(coupon => coupon.mobileNumber === mobileNumber);

        // Sort coupons
        userCoupons.sort((a, b) => {
            if (b.serialNumber !== a.serialNumber) {
                return b.serialNumber - a.serialNumber;
            }
            const dateA = new Date(a.dateScanned);
            const dateB = new Date(b.dateScanned);
            return dateB - dateA;
        });

        const totalPoints = userCoupons.reduce((sum, coupon) => sum + coupon.points, 0);

        res.render('qr-apply-history', { coupons: userCoupons, totalPoints });
    } catch (err) {
        console.error('Error fetching coupon history:', err);
        res.json({ success: false, message: 'Failed to fetch QR apply history.' });
    }
});

// Helper function to save scanned coupon data to Firebase
async function saveScannedCoupon(couponData) {
    try {
        const couponId = `${couponData.mobileNumber}_${couponData.qrCode}_${Date.now()}`;
        const couponRef = db.ref(`coupons/${couponId}`);
        
        await couponRef.set(couponData);
    } catch (err) {
        console.error('Error saving scanned coupon data:', err);
    }
}

// Define the route for the product page
userRouter.get('/products', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'products.html'));
});

// ===============================
// ADD BANK PAGE
// ===============================
userRouter.get('/add-bank', isAuthenticated, async (req, res) => {
    try {
        const mobileNumber = req.session.mobileNumber;

        if (!mobileNumber) {
            return res.redirect('/user');
        }

        // ✅ Firebase Admin SDK
        const userRef = db.ref(`users/${mobileNumber}`);
        const snapshot = await userRef.get();

        if (!snapshot.exists()) {
            return res.redirect('/user/register');
        }

        const user = snapshot.val();

        // Optional inactive check
        if (user.status !== 'active') {
            return res.status(403).send('Your account is disabled.');
        }

        res.render('add-bank', {
            mobileNumber
        });

    } catch (error) {
        console.error('Error loading add-bank page:', error);

        res.status(500).send('Internal Server Error');
    }
});


// ===============================
// CASHFREE KEYS
// ===============================
const CLIENT_ID = 'CF508845CTSV55DU10IC73E6MH8G';
const CLIENT_SECRET = 'cfsk_ma_prod_42ca1b1243aefbee6cfbced2f9d4da89_92ab50a6';


// ===============================
// ADD BENEFICIARY
// ===============================
userRouter.post('/add-beneficiary', isAuthenticated, async (req, res) => {

    try {

        const mobileNumber = req.session.mobileNumber;

        if (!mobileNumber) {
            return res.status(400).json({
                success: false,
                message: 'Session expired'
            });
        }

        const {
            beneficiaryName,
            bankAccountNumber,
            bankIFSC,
            vpa,
            beneficiaryPhone,
            beneficiaryCountryCode,
        } = req.body;

        // ===============================
        // VALIDATION
        // ===============================
        if (
            !beneficiaryName ||
            !bankAccountNumber ||
            !bankIFSC ||
            !beneficiaryPhone
        ) {
            return res.status(400).json({
                success: false,
                message: 'Required fields are missing'
            });
        }

        // ===============================
        // FETCH USER
        // ===============================
        const userRef = db.ref(`users/${mobileNumber}`);
        const snapshot = await userRef.get();

        if (!snapshot.exists()) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = snapshot.val();

        // Optional inactive check
        if (user.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Account disabled'
            });
        }

        // ===============================
        // BENEFICIARY ID
        // ===============================
        const beneficiaryId = `JL${mobileNumber}`;

        // ===============================
        // CASHFREE REQUEST
        // ===============================
        const options = {
            method: 'POST',
            url: 'https://api.cashfree.com/payout/beneficiary',

            headers: {
                accept: 'application/json',
                'x-api-version': '2024-01-01',
                'content-type': 'application/json',
                'x-client-id': CLIENT_ID,
                'x-client-secret': CLIENT_SECRET,
            },

            data: {
                beneficiary_id: beneficiaryId,

                beneficiary_name: beneficiaryName,

                beneficiary_instrument_details: {
                    bank_account_number: bankAccountNumber,
                    bank_ifsc: bankIFSC,
                    vpa: vpa || null,
                },

                beneficiary_contact_details: {
                    beneficiary_country_code:
                        beneficiaryCountryCode || '+91',

                    beneficiary_phone: beneficiaryPhone,
                },
            },
        };

        const response = await axios.request(options);

        // ===============================
        // SAVE TO FIREBASE
        // ===============================
        await userRef.update({
            beneficiaryAdded: true,
            beneficiaryId: beneficiaryId,
            beneficiaryName: beneficiaryName,
            bankAccountNumber: bankAccountNumber,
            bankIFSC: bankIFSC,
            beneficiaryPhone: beneficiaryPhone,
            beneficiaryCreatedAt: Date.now()
        });

        // ===============================
        // SUCCESS
        // ===============================
        return res.status(200).json({
            success: true,
            message: 'Bank Account added successfully',
            beneficiaryId,
            data: response.data,
        });

    } catch (error) {

        console.error(
            'Error adding beneficiary:',
            error.response?.data || error.message
        );

        return res.status(500).json({
            success: false,
            message: 'Error adding bank account',
            error: error.response?.data || error.message,
        });
    }
});

// Render the withdraw page
userRouter.get("/withdraw", isAuthenticated, async (req, res) => {

    const mobileNumber = req.session.mobileNumber;

    if (!mobileNumber) {

        return res.status(400).render("withdraw", {
            walletBalance: 0,
            message: "Mobile number not found in session.",
            beneficiary_id: null,
        });

    }

    try {

        const userRef = db.ref(`users/${mobileNumber}`);
        const snapshot = await userRef.get();

        if (!snapshot.exists()) {

            return res.status(404).render("withdraw", {
                walletBalance: 0,
                message: "User not found.",
                beneficiary_id: null,
            });

        }

        const user = snapshot.val();

        // CHECK USER STATUS
        if (user.status !== "active") {

            return res.status(403).send(`

                <div style="
                    font-family:Inter,sans-serif;
                    min-height:100vh;
                    display:flex;
                    justify-content:center;
                    align-items:center;
                    background:#f6f8fb;
                    padding:20px;
                ">

                    <div style="
                        background:white;
                        padding:40px;
                        border-radius:24px;
                        text-align:center;
                        max-width:420px;
                        width:100%;
                        box-shadow:0 10px 30px rgba(0,0,0,0.08);
                    ">

                        <h1 style="
                            color:#dc2626;
                            margin-bottom:12px;
                            font-size:28px;
                        ">
                            Account Disabled
                        </h1>

                        <p style="
                            color:#64748b;
                            font-size:15px;
                            line-height:1.6;
                            margin-bottom:25px;
                        ">
                            Your account has been disabled by admin.
                            Withdrawals are not allowed.
                        </p>

                        <a href="/user/dashboard" style="
                            display:inline-block;
                            padding:12px 20px;
                            border-radius:12px;
                            background:#4f46e5;
                            color:white;
                            text-decoration:none;
                            font-weight:600;
                        ">
                            Go Back
                        </a>

                    </div>

                </div>

            `);

        }

        // ===============================
        // CHECK BANK ACCOUNT EXISTS
        // ===============================

        const beneficiary_id = `JL${mobileNumber}`;

        const beneficiary = await fetchBeneficiaryFromCashfree(
            beneficiary_id
        );

        // IF BENEFICIARY NOT FOUND
        if (!beneficiary) {

            return res.redirect('/user/add-bank');

        }

        // IF BENEFICIARY NOT VERIFIED
        if (
            beneficiary.beneficiary_status !== 'VERIFIED'
        ) {

            return res.redirect('/user/add-bank');

        }

        // WALLET
        const walletBalance = Number(
            user.walletBalance || 0
        );

        // OPEN WITHDRAW PAGE
        return res.render("withdraw", {

            walletBalance,
            message: null,
            beneficiary_id,

        });

    } catch (error) {

        console.error(
            "Withdraw page error:",
            error.response?.data || error.message
        );

        return res.status(500).render("withdraw", {

            walletBalance: 0,
            message: "Failed to fetch wallet balance.",
            beneficiary_id: null,

        });

    }

});

// ================= WITHDRAW MONEY =================
userRouter.post(
    "/withdraw",
    isAuthenticated,
    async (req, res) => {

        const mobileNumber = req.session.mobileNumber;
        const { withdrawAmount } = req.body;

        // No mobile number
        if (!mobileNumber) {

            return res.status(400).render("withdraw", {
                walletBalance: 0,
                message: "Mobile number not found in session.",
                beneficiary_id: null,
            });

        }

        try {

            // ✅ Firebase Admin SDK
            const userRef = db.ref(`users/${mobileNumber}`);
            const snapshot = await userRef.get();

            // User not found
            if (!snapshot.exists()) {

                return res.status(404).render("withdraw", {
                    walletBalance: 0,
                    message: "User not found.",
                    beneficiary_id: `JL${mobileNumber}`,
                });

            }

            const user = snapshot.val();

            // Account disabled
            if (user.status !== "active") {

                return res.status(403).render("withdraw", {
                    walletBalance: Number(user.walletBalance || 0),
                    message: "Your account has been disabled by admin.",
                    beneficiary_id: `JL${mobileNumber}`,
                });

            }

            // Wallet balance
            const walletBalance = Number(user.walletBalance || 0);

            // Withdrawal amount validation
            if (
                !withdrawAmount ||
                Number(withdrawAmount) < 50
            ) {

                return res.render("withdraw", {
                    walletBalance,
                    message: "Minimum withdrawal amount is 50.",
                    beneficiary_id: `JL${mobileNumber}`,
                });

            }

            // Insufficient balance
            if (Number(withdrawAmount) > walletBalance) {

                return res.render("withdraw", {
                    walletBalance,
                    message: "Insufficient balance to withdraw.",
                    beneficiary_id: `JL${mobileNumber}`,
                });

            }

            // Transfer details
            const transfer_id =
                `JL${mobileNumber}${Math.floor(
                    1000 + Math.random() * 9000
                )}`;

            const beneficiary_id = `JL${mobileNumber}`;

            // Cashfree payload
            const cashfreePayload = {
                transfer_id,
                transfer_amount: Number(withdrawAmount),
                transfer_mode: "banktransfer",
                beneficiary_details: {
                    beneficiary_id
                }
            };

            // Send transfer request
            const response = await axios.post(
                "https://api.cashfree.com/payout/transfers",
                cashfreePayload,
                {
                    headers: {
                        accept: "application/json",
                        "x-api-version": "2024-01-01",
                        "content-type": "application/json",
                        "x-client-id": CLIENT_ID,
                        "x-client-secret": CLIENT_SECRET,
                    },
                }
            );

            const status = response.data.status;

            // Success statuses
            if (
                [
                    "RECEIVED",
                    "APPROVAL_PENDING",
                    "PENDING",
                    "SUCCESS"
                ].includes(status)
            ) {

                const newWalletBalance =
                    walletBalance - Number(withdrawAmount);

                // ✅ Update wallet balance
                await userRef.update({
                    walletBalance: newWalletBalance,
                });

                // Save withdrawal history
                const withdrawalsRef = db.ref(
                    `withdrawals/${mobileNumber}`
                );

                const newWithdrawalRef =
                    withdrawalsRef.push();

                await newWithdrawalRef.set({
                    transfer_id,
                    transfer_amount: Number(withdrawAmount),
                    status,
                    created_at: new Date().toISOString(),
                });

                return res.render("withdraw", {
                    walletBalance: newWalletBalance,
                    message: "Withdrawal successful!",
                    beneficiary_id,
                });

            }

            // Failed statuses
            if (
                ["FAILED", "REJECTED"].includes(status)
            ) {

                return res.render("withdraw", {
                    walletBalance,
                    message:
                        "Withdrawal failed. Please try again later.",
                    beneficiary_id,
                });

            }

            // Unknown status
            return res.render("withdraw", {
                walletBalance,
                message:
                    "Unexpected response from payment gateway.",
                beneficiary_id,
            });

        } catch (error) {

            console.error(
                "Withdraw Error:",
                error.response?.data || error.message
            );

            return res.status(500).render("withdraw", {
                walletBalance: 0,
                message:
                    "An error occurred while processing withdrawal.",
                beneficiary_id: null,
            });

        }

    }
);


// Function to fetch transfer status from Cashfree using the correct GET endpoint
async function fetchStatusFromCashfree(transferId) {
  try {
    // Send GET request to Cashfree's payout API to get transfer status
    const response = await axios.get(
      `https://api.cashfree.com/payout/transfers`,
      {
        headers: {
          'X-Client-Id': CLIENT_ID,
          'X-Client-Secret': CLIENT_SECRET,
          'x-api-version': '2024-01-01'
        },
        params: {
          transfer_id: transferId // Pass transfer_id as a query parameter
        }
      }
    );

    // Now, we need to check the response structure correctly
    if (response.data && response.data.status) {
      const status = response.data.status || 'Unknown'; // Accessing status directly
      return status; // Return the status
    } else {
      return 'Unknown'; // Return 'Unknown' if no status field is found
    }
  } catch (error) {
    return 'Error'; // Return 'Error' if there was an issue
  }
}

// ================= USER WITHDRAW HISTORY =================
userRouter.get('/user-withdraw', isAuthenticated, async (req, res) => {

    const mobileNumber = req.session.mobileNumber;

    try {

        // ✅ Firebase Admin SDK
        const withdrawRef = db.ref(`withdrawals/${mobileNumber}`);
        const snapshot = await withdrawRef.get();

        let withdrawals = [];

        if (snapshot.exists()) {

            const data = snapshot.val();

            for (const key in data) {

                const withdrawal = data[key];

                const status = await fetchStatusFromCashfree(
                    withdrawal.transfer_id
                );

                withdrawals.push({
                    transfer_id: withdrawal.transfer_id,
                    transfer_amount: withdrawal.transfer_amount,
                    created_at: withdrawal.created_at,
                    status
                });

            }

        }

        // Latest first
        withdrawals.sort((a, b) => {
            return new Date(b.created_at) - new Date(a.created_at);
        });

        res.render('user-withdraw', { withdrawals });

    } catch (error) {

        console.error('Error fetching withdrawals:', error);

        res.status(500).send('Internal Server Error');

    }

});



// ================= FETCH BENEFICIARY =================
async function fetchBeneficiaryFromCashfree(beneficiary_id) {

    try {

        const response = await axios.get(
            'https://api.cashfree.com/payout/beneficiary',
            {
                headers: {
                    accept: 'application/json',
                    'x-api-version': '2024-01-01',
                    'x-client-id': CLIENT_ID,
                    'x-client-secret': CLIENT_SECRET,
                },
                params: {
                    beneficiary_id
                }
            }
        );

        return response.data;

    } catch (error) {

        console.error(
            'Error fetching beneficiary:',
            error.response?.data || error.message
        );

        // Beneficiary not found
        if (
            error.response?.data?.code === 'beneficiary_not_found'
        ) {
            return null;
        }

        throw new Error('Failed to fetch beneficiary details.');

    }

}



// ================= EDIT DETAILS PAGE =================
userRouter.get('/edit-details', isAuthenticated, async (req, res) => {

    const mobileNumber = req.session.mobileNumber;

    if (!mobileNumber) {

        return res.status(400).render('error', {
            message: 'Mobile number not found in session.'
        });

    }

    const beneficiary_id = `JL${mobileNumber}`;

    try {

        // Fetch beneficiary
        const beneficiary = await fetchBeneficiaryFromCashfree(
            beneficiary_id
        );

        // Not found
        if (!beneficiary) {
            return res.redirect('/user/add-bank');
        }

        // Not verified
        if (beneficiary.beneficiary_status !== 'VERIFIED') {
            return res.redirect('/user/add-bank');
        }

        // Render page
        res.render('edit-details', {
            beneficiary,
            message: null
        });

    } catch (error) {

        console.error('Edit details error:', error);

        res.status(500).send(
            'An error occurred while fetching beneficiary details.'
        );

    }

});



// ================= REMOVE BANK ACCOUNT =================
userRouter.post(
    '/edit-details/remove',
    isAuthenticated,
    async (req, res) => {

        const mobileNumber = req.session.mobileNumber;

        if (!mobileNumber) {

            return res.status(400).render('error', {
                message: 'Mobile number not found in session.'
            });

        }

        const beneficiary_id = `JL${mobileNumber}`;

        try {

            // Delete beneficiary from Cashfree
            const response = await axios.delete(
                'https://api.cashfree.com/payout/beneficiary',
                {
                    headers: {
                        accept: 'application/json',
                        'x-api-version': '2024-01-01',
                        'x-client-id': CLIENT_ID,
                        'x-client-secret': CLIENT_SECRET,
                    },
                    params: {
                        beneficiary_id
                    }
                }
            );

            // Deleted successfully
            if (
                response.data.beneficiary_status === 'DELETED'
            ) {

                return res.redirect('/user/add-bank');

            }

            // Failed delete
            return res.redirect('/user/add-bank');

        } catch (error) {

            console.error(
                'Remove beneficiary error:',
                error.response?.data || error.message
            );

            res.status(500).send(
                'An error occurred while removing bank account.'
            );

        }

    }
);

/////////////////////////////////////

// USER SCHEMES PAGE

userRouter.get('/schemes', async (req, res) => {

    try {

        const page = parseInt(req.query.page) || 1;

        const limit = 10;

        const notificationsRef = db.ref('notifications');

        const snapshot = await notificationsRef.get();

        let schemes = [];

        if (snapshot.exists()) {

            const data = snapshot.val();

            for (const id in data) {

                schemes.push({
                    id,
                    text: data[id].text || '',
                    timestamp: data[id].timestamp || 0
                });

            }

        }

        // Latest first
        schemes.sort((a, b) => b.timestamp - a.timestamp);

        // Pagination
        const totalSchemes = schemes.length;

        const totalPages = Math.ceil(totalSchemes / limit);

        const startIndex = (page - 1) * limit;

        const endIndex = startIndex + limit;

        const paginatedSchemes = schemes.slice(startIndex, endIndex);

        res.render('schemes', {
            schemes: paginatedSchemes,
            currentPage: page,
            totalPages
        });

    } catch (error) {

        console.log('==========================');
        console.log('SCHEMES PAGE ERROR');
        console.log('==========================');

        console.log(error);

        res.status(500).send('Internal Server Error');

    }

});

// ✅ Temporary route to check your Render outbound IP
userRouter.get("/check-ip", async (req, res) => {
  try {
    const response = await axios.get("https://api.ipify.org?format=json");
    console.log("Current outbound IP:", response.data.ip);
    res.send(`Current outbound IP: ${response.data.ip}`);
  } catch (error) {
    console.error("Error fetching IP:", error.message);
    res.status(500).send("Error fetching IP");
  }
});

module.exports = userRouter;



















































































































































































