const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const QRCode = require("qrcode");
const admin = require('firebase-admin');
const session = require("express-session");
const fs = require('fs');
const archiver = require("archiver"); // To create ZIP files
const axios = require("axios"); // To make HTTP requests to ImageBB
const multer = require("multer"); // For handling file uploads
const FormData = require('form-data');
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const adminRouter = express.Router();

// 👉 PUT YOUR DOWNLOADED FILE HERE
const serviceAccount = require('./fir-c1b0e-firebase-adminsdk-fbsvc-052b9da7d2.json');

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200
});

adminRouter.use(adminLimiter);

// 🔥 Firebase Admin INIT (safe + correct)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),

        // ⚠️ MUST MATCH serviceAccount project_id
        databaseURL: "https://fir-c1b0e-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}

// DB reference
const db = admin.database();

// Log a success message to confirm the connection
console.log("Firebase connected successfully!");


// Middleware for static files and body parsing
adminRouter.use(express.static(path.join(__dirname, "public")));
adminRouter.use(bodyParser.urlencoded({ extended: true }));
adminRouter.use(bodyParser.json());

// ========================================
// SESSION CONFIG (ADMIN)
// ========================================
adminRouter.use(session({
    secret: process.env.SESSION_SECRET || "admin_secret_key_123",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: true, // set TRUE only in HTTPS production
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

const loginLimiter = rateLimit({

    windowMs: 15 * 60 * 1000,

    max: 5,

    message: "Too many login attempts"
});

// ========================================
// ADMIN AUTH MIDDLEWARE
// ========================================
function checkAdminAuth(req, res, next) {

    const publicRoutes = [
        "/login",
        "/logout"
    ];

    // allow public routes
    if (publicRoutes.includes(req.path)) {
        return next();
    }

    // session check
    if (!req.session || !req.session.adminLoggedIn) {
        return res.redirect("/admin/login");
    }

    next();
}

// apply middleware
adminRouter.use(checkAdminAuth);

// Directory where batches are stored (kept as is for consistency)
const batchesDir = path.join(__dirname, "qr_batches");

// Function to get the next batch ID (still based on existing folders)
function getNextBatchId() {
    const batchRef = db.ref("batches");

    return batchRef.get().then(snapshot => {
        if (snapshot.exists()) {
            const batches = snapshot.val();
            const batchIds = Object.keys(batches);

            const highestBatch = batchIds.length === 0
                ? 0
                : Math.max(...batchIds.map(id => parseInt(id.replace("QR", ""))));

            return `QR${String(highestBatch + 1).padStart(4, "0")}`;
        } else {
            return "QR0001";
        }
    });
}

// Function to generate random alphanumeric string of length 9
function generateRandomString(length) {
    const charset = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";

    for (let i = 0; i < length; i++) {
        result += charset[Math.floor(Math.random() * charset.length)];
    }

    return result;
}

// Serve the login page
adminRouter.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "login.html"));
});

adminRouter.post("/login", (req, res) => {
    const { email, password } = req.body;

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {

        req.session.adminLoggedIn = true;
        req.session.adminEmail = email;

        return res.redirect("/admin/home");
    }

    return res.redirect("/admin/login");
});
// Protect the /home route
adminRouter.get("/home", (req, res) => {
    if (req.session.adminLoggedIn) {
        return res.sendFile(path.join(__dirname, "views", "home.html"));
    }
    return res.redirect("/admin/login");
});

adminRouter.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log("Session destroy error:", err);
        }

        res.clearCookie("connect.sid");
        return res.redirect("/admin/login");
    });
});



// Serve the QR code creation page
adminRouter.get("/create-qr", (req, res) => {
    if (req.session.adminLoggedIn) {
        res.sendFile(path.join(__dirname, "views", "create-qr.html"));
    } else {
        res.redirect("/admin/login");
    }
});

// Handle QR code creation POST request
adminRouter.post("/create-qr", async (req, res) => {

    try {

        const numQrs = parseInt(req.body.numQrs);
        if (
    !Number.isInteger(numQrs) ||
    numQrs < 1 ||
    numQrs > 5001
) {
    return res.status(400).send("Invalid QR amount");
}
        const points = req.body.points;

        const batchId = await getNextBatchId();
        const timestamp = new Date().toISOString();

       // Batch object
const batch = {
    createdAt: timestamp,
    points: points,
    couponCount: numQrs,
    qrCodes: []
};

// ✅ MOVE THIS HERE
const qrIndexUpdates = {};

// Generate QR codes
for (let i = 0; i < numQrs; i++) {

    const qrCodeData = generateRandomString(10);

    batch.qrCodes.push({
        code: qrCodeData,
        status: "Not Scanned",
        points: points,
        createdAt: timestamp
    });

    // FAST LOOKUP INDEX
    qrIndexUpdates[qrCodeData] = {
        batchId,
        index: i
    };
}

// SAVE TO FIREBASE
const batchRef = db.ref(`batches/${batchId}`);

await batchRef.set(batch);

// SAVE INDEX
await db.ref("qrIndex").update(qrIndexUpdates)

        // PREMIUM SUCCESS UI
        res.send(`

<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>QR Generated</title>

<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

<style>

*{
    margin:0;
    padding:0;
    box-sizing:border-box;
}

body{
    font-family:'Inter',sans-serif;
    background:#f6f8fb;
    min-height:100dvh;
    display:flex;
    justify-content:center;
    align-items:center;
    padding:20px;
    overflow:hidden;
    position:relative;
}

/* ===== BACKGROUND ===== */

.bg{
    position:fixed;
    border-radius:50%;
    filter:blur(80px);
    opacity:.5;
    z-index:0;
}

.bg1{
    width:320px;
    height:320px;
    background:#c7d2fe;
    top:-100px;
    left:-100px;
}

.bg2{
    width:350px;
    height:350px;
    background:#bbf7d0;
    bottom:-120px;
    right:-100px;
}

/* ===== CARD ===== */

.card{
    position:relative;
    z-index:2;
    width:100%;
    max-width:520px;
    background:rgba(255,255,255,0.8);
    backdrop-filter:blur(20px);
    border:1px solid rgba(255,255,255,0.7);
    border-radius:30px;
    padding:40px;
    text-align:center;
    box-shadow:
        0 20px 40px rgba(15,23,42,0.08),
        0 2px 10px rgba(15,23,42,0.04);
}

/* ===== ICON ===== */

.icon{
    width:85px;
    height:85px;
    margin:auto;
    margin-bottom:24px;
    border-radius:28px;
    display:flex;
    justify-content:center;
    align-items:center;
    font-size:38px;
    background:linear-gradient(135deg,#dcfce7,#bbf7d0);
    color:#16a34a;
}

/* ===== TEXT ===== */

h1{
    font-size:32px;
    color:#0f172a;
    margin-bottom:12px;
}

.desc{
    color:#64748b;
    font-size:15px;
    line-height:1.7;
    margin-bottom:30px;
}

/* ===== INFO BOXES ===== */

.stats{
    display:grid;
    grid-template-columns:repeat(2,1fr);
    gap:14px;
    margin-bottom:28px;
}

.box{
    padding:18px;
    border-radius:18px;
    background:#ffffffcc;
    border:1px solid #e2e8f0;
}

.box h3{
    font-size:13px;
    color:#64748b;
    margin-bottom:8px;
    font-weight:500;
}

.box p{
    font-size:24px;
    font-weight:700;
    color:#0f172a;
}

/* ===== BUTTON ===== */

.btn{
    display:inline-flex;
    justify-content:center;
    align-items:center;
    width:100%;
    height:58px;
    border:none;
    border-radius:18px;
    background:linear-gradient(135deg,#818cf8,#6366f1);
    color:white;
    text-decoration:none;
    font-size:15px;
    font-weight:600;
    transition:.25s;
    box-shadow:0 10px 20px rgba(99,102,241,.18);
}

.btn:hover{
    transform:translateY(-2px);
}

/* ===== MOBILE ===== */

@media(max-width:550px){

    .card{
        padding:28px 20px;
        border-radius:24px;
    }

    h1{
        font-size:26px;
    }

    .stats{
        grid-template-columns:1fr;
    }

    .icon{
        width:72px;
        height:72px;
        font-size:30px;
    }

}

</style>

</head>

<body>

<div class="bg bg1"></div>
<div class="bg bg2"></div>

<div class="card">

    <div class="icon">
        ✓
    </div>

    <h1>
        QR Codes Generated
    </h1>

    <div class="desc">
        Your QR batch has been created successfully and securely stored in database.
    </div>

    <div class="stats">

        <div class="box">
            <h3>Batch ID</h3>
            <p>${batchId}</p>
        </div>

        <div class="box">
            <h3>Total QR Codes</h3>
            <p>${numQrs}</p>
        </div>

    </div>

    <a href="/admin/view-qr" class="btn">
        View QR Batches
    </a>

</div>

</body>
</html>

        `);

    } catch (error) {

        console.error("Error saving batch data:", error);

        res.status(500).send("Error saving QR batch.");

    }

});
// Serve the home page (admin dashboard)
adminRouter.get("/", (req, res) => {
    if (req.session.adminLoggedIn) {
        res.redirect("/home");
    } else {
        res.redirect("/login");
    }
});


// ================= VIEW ALL BATCHES =================
adminRouter.get("/view-qr", async (req, res) => {

  if (!req.session.adminLoggedIn) {
    return res.redirect("/admin/login");
}

    try {

        const page = parseInt(req.query.page) || 1;
        const limit = 20;

        const snapshot = await db.ref("batches").get();

        if (!snapshot.exists()) {
            return res.render("view-qr", {
                qrBatches: [],
                currentPage: 1,
                totalPages: 1
            });
        }

        const data = snapshot.val();

        // CONVERT TO ARRAY
        let qrBatches = Object.keys(data).map(batchId => {

            const batch = data[batchId];

            return {
                id: batchId,
                createdAt: batch.createdAt,
                points: batch.points,
                couponCount: batch.couponCount,
                active: true
            };
        });

        // ===== LATEST FIRST =====
        qrBatches.sort((a, b) => {

            const aNum = parseInt(a.id.replace("QR", ""));
            const bNum = parseInt(b.id.replace("QR", ""));

            return bNum - aNum;
        });

        // ===== PAGINATION =====
        const totalBatches = qrBatches.length;
        const totalPages = Math.ceil(totalBatches / limit);

        const start = (page - 1) * limit;
        const end = start + limit;

        const paginatedBatches = qrBatches.slice(start, end);

        res.render("view-qr", {
            qrBatches: paginatedBatches,
            currentPage: page,
            totalPages
        });

    } catch (error) {

        console.error("Error fetching batches:", error);
        res.status(500).send("Error fetching batches.");
    }
});


// ================= VIEW SINGLE BATCH =================
adminRouter.get("/view-qr/:batchId", async (req, res) => {
    const batchId = req.params.batchId;

    try {
        const snapshot = await db.ref(`batches/${batchId}`).get();

        if (!snapshot.exists()) {
            return res.status(404).send("Batch not found.");
        }

        const batch = snapshot.val();

        res.render("view-qr-batch", {
            qrCodes: batch.qrCodes,
            batchId: batchId
        });

    } catch (error) {
        console.error("Error fetching batch:", error);
        res.status(500).send("Error fetching batch.");
    }
});


// ================= EDIT QR POINTS =================
adminRouter.put("/edit-qr/:qrCode", async (req, res) => {
    const qrCode = req.params.qrCode;
    const newPoints = Number(req.body.points);

if (!Number.isFinite(newPoints)) {
    return res.status(400).send("Invalid points");
}

    try {
        const snapshot = await db.ref("batches").get();

        if (!snapshot.exists()) {
            return res.status(404).send("No batches found.");
        }

        const batches = snapshot.val();

        for (const batchId in batches) {
            const batch = batches[batchId];

            const qr = batch.qrCodes.find(q => q.code === qrCode);

            if (qr) {
                qr.points = newPoints;

                await db.ref(`batches/${batchId}`).update({
                    qrCodes: batch.qrCodes
                });

                return res.send({
                    success: true,
                    message: "Points updated successfully"
                });
            }
        }

        return res.status(404).send("QR code not found.");

    } catch (error) {
        console.error("Error fetching batches:", error);
        res.status(500).send("Error fetching batches.");
    }
});


// ================= TOGGLE QR STATUS =================
adminRouter.put("/toggle-qr-status/:qrCode", async (req, res) => {
    const qrCode = req.params.qrCode;

    try {
        const snapshot = await db.ref("batches").get();

        if (!snapshot.exists()) {
            return res.status(404).send("No batches found.");
        }

        const batches = snapshot.val();

        for (const batchId in batches) {
            const batch = batches[batchId];

            const qr = batch.qrCodes.find(q => q.code === qrCode);

            if (qr) {
                const newStatus = qr.status === "Scanned" ? "Not Scanned" : "Scanned";
                qr.status = newStatus;

                await db.ref(`batches/${batchId}`).update({
                    qrCodes: batch.qrCodes
                });

                return res.status(200).json({
                    message: "QR Code status updated successfully",
                    qrCode,
                    newStatus
                });
            }
        }

        return res.status(404).send(`QR Code ${qrCode} not found in any batch.`);

    } catch (error) {
        console.error("Error fetching batches:", error);
        return res.status(500).send("Error fetching batches.");
    }
});


// Route to generate QR code image
adminRouter.get("/view-qr-image/:qrCode", (req, res) => {
    const { qrCode } = req.params;

    // Generate QR Code as a PNG data URL
    QRCode.toDataURL(qrCode, { width: 300 }, (err, url) => {
        if (err) {
            res.status(500).send("Error generating QR code");
        } else {
            res.send(`<img src="${url}" alt="QR Code" />`);
        }
    });
});

adminRouter.get("/download-batch/:batchId", async (req, res) => {
    const batchId = req.params.batchId;

    try {
        // ✅ FIXED FIREBASE ADMIN USAGE
        const batchRef = db.ref(`batches/${batchId}`);
        const snapshot = await batchRef.get();

        if (!snapshot.exists()) {
            return res.status(404).send("Batch not found.");
        }

        const batchData = snapshot.val();

        if (!batchData.qrCodes || batchData.qrCodes.length === 0) {
            return res.status(404).send("No QR codes found in batch.");
        }

        const qrCodes = batchData.qrCodes;

        // ZIP setup
        const zipFilePath = path.join(__dirname, `${batchId}.zip`);
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        archive.on("error", (err) => {
            console.error("Archive error:", err);
            res.status(500).send({ error: err.message });
        });

        output.on("close", () => {
            res.download(zipFilePath, `${batchId}.zip`, (err) => {
                if (err) {
                    console.error("Download error:", err);
                }

                try {
                    fs.unlinkSync(zipFilePath);
                } catch (e) {}
            });
        });

        archive.pipe(output);

        const generateAndAppendQR = async (qrCode) => {
            try {
                if (!qrCode?.code) return;

                const buffer = await QRCode.toBuffer(qrCode.code);
                archive.append(buffer, { name: `${qrCode.code}.png` });
            } catch (error) {
                console.error("QR generation error:", error);
            }
        };

        const batchSize = 500;

        for (let i = 0; i < qrCodes.length; i += batchSize) {
            const batch = qrCodes.slice(i, i + batchSize);
            const imagePromises = batch.map(generateAndAppendQR);

            await Promise.all(imagePromises);
        }

        archive.finalize();

    } catch (error) {
        console.error("Error fetching batch data:", error);
        res.status(500).send("Error fetching batch data.");
    }
});


// PUT route to handle batch point update
adminRouter.put('/edit-batch/:batchId', async (req, res) => {
    const batchId = req.params.batchId;
   const newPoints = Number(req.body.points);


    // Check if the points are valid
    if (!newPoints || isNaN(newPoints)) {
        return res.status(400).json({ message: "Invalid points provided" });
    }

    try {
        // ✅ Firebase Admin correct reference
        const batchRef = db.ref(`batches/${batchId}`);

        // Fetch batch data from Firebase
        const snapshot = await batchRef.get();
        if (!snapshot.exists()) {
            return res.status(404).json({ message: "Batch not found." });
        }

        const batchData = snapshot.val();
        const qrCodes = batchData.qrCodes;

        // Update the batch-level points
        batchData.points = newPoints;

        // Update points for each QR code in the batch
        qrCodes.forEach(qr => {
            qr.points = newPoints;
        });

        // Update the batch in Firebase
        await batchRef.update({
            points: batchData.points,
            qrCodes: qrCodes
        });

        // Redirect back to view page
        res.redirect(`/admin/view-qr/${batchId}`);

    } catch (error) {
        console.error("Error updating batch points:", error);
        res.status(500).json({ message: "Failed to update batch points" });
    }
});

// DELETE route to delete a batch
adminRouter.delete("/delete-batch/:batchId", async (req, res) => {
    const batchId = req.params.batchId;
    const { password } = req.body;  // Get the password from the request body

    // Check if password is correct
   const correctPassword = process.env.DELETE_PASSWORD; // Password to delete the batch
    if (password !== correctPassword) {
        return res.status(403).send({ success: false, message: "Invalid password." });
    }

    try {
        // ✅ Firebase Admin SDK correct reference
        const batchRef = db.ref(`batches/${batchId}`);

        // Check if the batch exists in Firebase
        const snapshot = await batchRef.get();
        if (!snapshot.exists()) {
            return res.status(404).send({ success: false, message: "Batch not found." });
        }

        // Delete the batch from Firebase
        await batchRef.remove();

        res.status(200).send({ success: true, message: "Batch deleted successfully" });

    } catch (error) {
        console.error("Error deleting batch:", error);
        res.status(500).send({ success: false, message: "Failed to delete batch." });
    }
});

// Route for user management page
adminRouter.get('/user-management', async (req, res) => {
    try {
        // ✅ Firebase Admin correct usage
        const usersRef = db.ref('users');
        const snapshot = await usersRef.get();

        if (!snapshot.exists()) {
            return res.status(500).send('Error reading users data');
        }

        let users = snapshot.val();

        // Convert the users object into an array
        users = Object.values(users);

        // Sort users
        users.sort((a, b) => {
            const aSerial = a.serialNumber ? parseInt(a.serialNumber, 10) : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const bSerial = b.serialNumber ? parseInt(b.serialNumber, 10) : (b.createdAt ? new Date(b.createdAt).getTime() : 0);

            return bSerial - aSerial;
        });

        res.render('user-management', { users });

    } catch (err) {
        console.error("Error fetching users:", err);
        return res.status(500).send('Error fetching users data');
    }
});


// Route for QR History Page (Admin)
adminRouter.get('/qr-history/:mobileNumber', async (req, res) => {

    const mobileNumber = req.params.mobileNumber;

    // PAGINATION
    const page = parseInt(req.query.page) || 1;
    const limit = 150;

    // SEARCH & FILTER
    const search = req.query.search || "";
    const startDate = req.query.startDate || "";
    const endDate = req.query.endDate || "";

    try {

        // FETCH COUPONS
        const couponsRef = db.ref('coupons');
        const snapshot = await couponsRef.get();

        if (!snapshot.exists()) {

            return res.render('qr-history-admin', {
                coupons: [],
                currentPage: 1,
                totalPages: 1,
                search,
                startDate,
                endDate
            });

        }

        let coupons = Object.values(snapshot.val());

        // FILTER BY MOBILE NUMBER
        let userCoupons = coupons.filter(
            coupon => coupon.mobileNumber === mobileNumber
        );

        // SEARCH QR CODE
        if (search) {

            userCoupons = userCoupons.filter(coupon =>
                coupon.qrCode &&
                coupon.qrCode.toLowerCase().includes(search.toLowerCase())
            );

        }

        // START DATE FILTER
        if (startDate) {

            const start = new Date(startDate);

            userCoupons = userCoupons.filter(coupon => {

                const couponDate = new Date(coupon.dateScanned);

                return couponDate >= start;

            });

        }

        // END DATE FILTER
        if (endDate) {

            const end = new Date(endDate);

            end.setHours(23, 59, 59, 999);

            userCoupons = userCoupons.filter(coupon => {

                const couponDate = new Date(coupon.dateScanned);

                return couponDate <= end;

            });

        }

        // LATEST FIRST
        userCoupons.sort((a, b) => {

            if (b.serialNumber !== a.serialNumber) {
                return b.serialNumber - a.serialNumber;
            }

            return new Date(b.dateScanned) - new Date(a.dateScanned);

        });

        // PAGINATION
        const totalCoupons = userCoupons.length;
        const totalPages = Math.ceil(totalCoupons / limit);

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;

        const paginatedCoupons =
            userCoupons.slice(startIndex, endIndex);

            const totalPoints = userCoupons.reduce((sum, coupon) => {
    return sum + Number(coupon.points || 0);
}, 0);

const totalScanned = userCoupons.length;

        // RENDER
   res.render('qr-history-admin', {

    coupons: paginatedCoupons,
    currentPage: page,
    totalPages,

    search,
    startDate,
    endDate,

    totalPoints,
    totalScanned

});

    } catch (err) {

        console.error("QR history error:", err);

        return res.json({
            success: false,
            message: 'Error fetching QR history.'
        });

    }

});

// Route to serve the edit form for user data
adminRouter.get('/edit-user/:mobileNumber', async (req, res) => {
    const mobileNumber = req.params.mobileNumber;

    try {
        // ✅ Firebase Admin correct usage
        const userRef = db.ref(`users/${mobileNumber}`);
        const snapshot = await userRef.get();

        if (!snapshot.exists()) {
            return res.status(404).send('User not found');
        }

        const user = snapshot.val();
        res.render('edit-user', { user });
    } catch (err) {
        return res.status(500).send('Error fetching user data');
    }
});

// Route to handle form submission and update user data in Firebase
adminRouter.post('/edit-user/:mobileNumber', async (req, res) => {
    const mobileNumber = req.params.mobileNumber;

    try {
        // ✅ Firebase Admin correct usage
        const userRef = db.ref(`users/${mobileNumber}`);
        const snapshot = await userRef.get();

        if (!snapshot.exists()) {
            return res.status(404).send('User not found');
        }

        const updatedUserData = req.body;

        if (updatedUserData.walletBalance) {
            updatedUserData.walletBalance = parseFloat(updatedUserData.walletBalance);
        }

        // ✅ Update using Admin SDK
        await userRef.update(updatedUserData);

        res.redirect('/admin/user-management');
    } catch (err) {
        return res.status(500).send('Error updating user data');
    }
});

// Route to get QR scan history (Admin)

adminRouter.get('/qr-admin-history', async (req, res) => {

    try {

        const page = parseInt(req.query.page) || 1;
        const limit = 250;

        const search = req.query.search || '';
        const startDate = req.query.startDate || '';
        const endDate = req.query.endDate || '';
        const mobileNumber = req.query.mobileNumber || '';
        const points = req.query.points || '';

        const qrHistoryRef = db.ref('coupons');

        const snapshot = await qrHistoryRef.get();

        if (!snapshot.exists()) {
            return res.status(500).send('Error reading coupon data');
        }

        let qrHistory = Object.values(snapshot.val());

        // SORT LATEST FIRST
        qrHistory.sort((a, b) => {
            return (b.serialNumber || 0) - (a.serialNumber || 0);
        });

        // SEARCH FILTER
        if (search) {

            qrHistory = qrHistory.filter(qr =>
                String(qr.qrCode || '')
                .toLowerCase()
                .includes(search.toLowerCase())
            );

        }

        // MOBILE FILTER
        if (mobileNumber) {

            qrHistory = qrHistory.filter(qr =>
                String(qr.mobileNumber || '')
                .includes(mobileNumber)
            );

        }

        // POINTS FILTER
        if (points) {

            qrHistory = qrHistory.filter(qr =>
                String(qr.points || '') === String(points)
            );

        }

        // DATE FILTER
        if (startDate) {

            qrHistory = qrHistory.filter(qr =>
                qr.dateScanned >= startDate
            );

        }

        if (endDate) {

            qrHistory = qrHistory.filter(qr =>
                qr.dateScanned <= endDate
            );

        }

        // TOTALS
        const totalCoupons = qrHistory.length;

        const totalPoints = qrHistory.reduce((sum, qr) => {
            return sum + Number(qr.points || 0);
        }, 0);

        // PAGINATION
        const totalPages = Math.ceil(totalCoupons / limit);

        const startIndex = (page - 1) * limit;

        const paginatedHistory =
            qrHistory.slice(startIndex, startIndex + limit);

        // RENDER
        res.render('qr-admin-history', {

            qrHistory: paginatedHistory,

            currentPage: page,
            totalPages,

            search,
            startDate,
            endDate,
            mobileNumber,
            points,

            totalCoupons,
            totalPoints

        });

    } catch (err) {

        console.error("QR Admin History Error:", err);

        return res.status(500).send('Error fetching QR history');

    }

});

// Route to display all users' wallet balances (Admin)
adminRouter.get('/wallet', async (req, res) => {
    try {
        const usersRef = db.ref('users');
        const snapshot = await usersRef.get();

        if (!snapshot.exists()) {
            return res.status(500).send('Error reading users data');
        }

        const users = snapshot.val();
        res.render('wallet', { users: Object.values(users) });
    } catch (err) {
        return res.status(500).send('Error fetching users data');
    }
});

adminRouter.post('/backup', async (req, res) => {

    try {

        const { password } = req.body;

        if (password !== '1234') {

            return res.status(401).send('Unauthorized');

        }

        // Get full Firebase data
        const snapshot = await db.ref('/').get();

        const backupData = snapshot.val() || {};

        const jsonData = JSON.stringify(
            backupData,
            null,
            2
        );

        const fileName =
            `firebase-backup-${Date.now()}.zip`;

        // Headers
        res.setHeader(
            'Content-Type',
            'application/zip'
        );

        res.setHeader(
            'Content-Disposition',
            `attachment; filename=${fileName}`
        );

        // Create ZIP
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        archive.pipe(res);

        // Add JSON inside ZIP
        archive.append(jsonData, {
            name: 'firebase-backup.json'
        });

        await archive.finalize();

    } catch (error) {

        console.log('BACKUP ERROR:', error);

        res.status(500).send('Backup failed');

    }

});

// ========================================
// CREATE DEALER PAGE
// ========================================

adminRouter.get('/create-dealer', async (req, res) => {

    try {

        const page = Number(req.query.page) || 1;

        const limit = 10;

        const dealerRef = db.ref('dealers');

        const snapshot = await dealerRef.get();

        let dealers = [];

        if (snapshot.exists()) {

            const data = snapshot.val();

            dealers = Object.keys(data).map(id => ({

                id,

                userId: data[id].userId || '',

                password: data[id].password || '',

                createdAt: data[id].createdAt || 0

            }));

        }

        // Latest first
        dealers.sort((a, b) => {

            return b.createdAt - a.createdAt;

        });

        // Pagination
        const totalDealers = dealers.length;

        const totalPages = Math.ceil(
            totalDealers / limit
        );

        const startIndex = (page - 1) * limit;

        const paginatedDealers =
            dealers.slice(
                startIndex,
                startIndex + limit
            );

        res.render('create-dealer', {

            dealers: paginatedDealers,

            currentPage: page,

            totalPages

        });

    } catch (error) {

        console.log(
            'CREATE DEALER PAGE ERROR:',
            error
        );

        res.status(500).send(
            'Internal Server Error'
        );

    }

});



// ========================================
// CREATE NEW DEALER
// ========================================

adminRouter.post('/create-dealer', async (req, res) => {

    try {

        const {
            userId,
            password
        } = req.body;

        // Validation
        if (!userId || !password) {

            return res.status(400).json({

                success:false,

                message:'User ID and password required'

            });

        }

        const dealerRef = db.ref(
            `dealers/${userId}`
        );

        // Check existing
        const snapshot =
            await dealerRef.get();

        if (snapshot.exists()) {

            return res.status(400).json({

                success:false,

                message:'Dealer already exists'

            });

        }

        // Save dealer
        await dealerRef.set({

            userId,

            password,

            createdAt: Date.now()

        });

        return res.json({

            success:true,

            message:'Dealer created successfully'

        });

    } catch (error) {

        console.log(
            'CREATE DEALER ERROR:',
            error
        );

        return res.status(500).json({

            success:false,

            message:'Failed to create dealer'

        });

    }

});

adminRouter.get('/dealers', async (req, res) => {

    try {

        const dealerRef = db.ref('dealers');

        const snapshot = await dealerRef.get();

        if (!snapshot.exists()) {

            return res.json({
                dealers: []
            });

        }

        const data = snapshot.val();

        let dealers = Object.keys(data).map(id => ({

            id,

            userId: data[id].userId || '',

            password: data[id].password || '',

            createdAt: data[id].createdAt || 0

        }));

        // Latest first
        dealers.sort((a, b) => {

            return b.createdAt - a.createdAt;

        });

        res.json({
            dealers
        });

    } catch (error) {

        console.log(
            'FETCH DEALERS ERROR:',
            error
        );

        res.status(500).json({

            success:false,

            message:'Failed to fetch dealers'

        });

    }

});



// ========================================
// DELETE DEALER
// ========================================

adminRouter.delete(
    '/delete-dealer/:dealerId',
    async (req, res) => {

    try {

        const { dealerId } = req.params;

        if (!dealerId) {

            return res.status(400).json({

                success:false,

                message:'Dealer ID missing'

            });

        }

        const dealerRef = db.ref(
            `dealers/${dealerId}`
        );

        const snapshot =
            await dealerRef.get();

        if (!snapshot.exists()) {

            return res.status(404).json({

                success:false,

                message:'Dealer not found'

            });

        }

        await dealerRef.remove();

        return res.json({

            success:true,

            message:'Dealer deleted successfully'

        });

    } catch (error) {

        console.log(
            'DELETE DEALER ERROR:',
            error
        );

        return res.status(500).json({

            success:false,

            message:'Failed to delete dealer'

        });

    }

});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
   filename: (req, file, cb) => {
  const safeName =
    crypto.randomBytes(16).toString("hex") +
    path.extname(file.originalname);

  cb(null, safeName);
}
  });
  
  const upload = multer({ storage: storage });
  

// POST endpoint for adding a beneficiary
// Your Cashfree credentials
const CLIENT_ID = process.env.CASHFREE_CLIENT_ID;
const CLIENT_SECRET = process.env.CASHFREE_CLIENT_SECRET;

// Function to fetch transfer status from Cashfree
async function fetchStatusFromCashfree(transferId) {

    if (!transferId) {
        return 'ERROR';
    }

    try {

        const response = await axios.get(
            'https://api.cashfree.com/payout/transfers',
            {
                headers: {
                    accept: 'application/json',
                    'X-Client-Id': CLIENT_ID,
                    'X-Client-Secret': CLIENT_SECRET,
                    'x-api-version': '2024-01-01'
                },

                params: {
                    transfer_id: transferId
                }
            }
        );

        // Direct response
        if (response.data && response.data.status) {
            return response.data.status;
        }

        // Array response support
        if (
            Array.isArray(response.data) &&
            response.data.length > 0 &&
            response.data[0].status
        ) {
            return response.data[0].status;
        }

        return 'UNKNOWN';

    } catch (error) {

        return 'ERROR';

    }

}



// GET /admin-withdraw
// Admin panel route to fetch all withdrawal requests

adminRouter.get('/admin-withdraw', async (req, res) => {

    try {

        // Firebase Admin SDK syntax
        const withdrawRef = db.ref('withdrawals');

        const snapshot = await withdrawRef.get();

        const withdrawals = [];

        if (snapshot.exists()) {

            const data = snapshot.val();

            // Loop all mobile numbers
            for (const mobileNumber in data) {

                const mobileWithdrawals = data[mobileNumber];

                // Loop withdrawals of each user
                for (const key in mobileWithdrawals) {

                    const withdrawal = mobileWithdrawals[key];

                    const {
                        transfer_id,
                        transfer_amount,
                        created_at
                    } = withdrawal;

                    // Skip invalid records
                    if (!transfer_id) {
                        continue;
                    }

                    // Fetch live status from Cashfree
                    const status =
                        await fetchStatusFromCashfree(
                            transfer_id
                        );

                    withdrawals.push({

                        mobileNumber,

                        transfer_id,

                        transfer_amount,

                        created_at,

                        status

                    });

                }

            }

        }

        // Latest first
        withdrawals.sort((a, b) => {
            return new Date(b.created_at)
                - new Date(a.created_at);
        });

        // Render page
        res.render('admin-withdraw', {
            withdrawals
        });

    } catch (error) {

        res.status(500).send(
            'Internal Server Error'
        );

    }

});

////////////////////////////////////////////////

// ==========================================
// ADMIN SCHEME PAGE
// FIREBASE ADMIN SDK VERSION
// ==========================================



// ==========================================
// GET ADMIN SCHEME PAGE
// ==========================================

adminRouter.get('/admin-scheme', async (req, res) => {

    try {

        console.log('==============================');
        console.log('ADMIN SCHEME PAGE OPENED');
        console.log('==============================');

        // Pagination
        const page = parseInt(req.query.page) || 1;

        const limit = 10;

        const startIndex = (page - 1) * limit;

        // Firebase Ref
        const notificationsRef = db.ref('notifications');

        console.log('Fetching notifications...');

        const snapshot = await notificationsRef.get();

        const notifications = [];

        if (snapshot.exists()) {

            const data = snapshot.val();

            console.log('Notifications fetched successfully');

            // Convert object to array
            for (const id in data) {

                notifications.push({

                    id,

                    text: data[id].text || '',

                    timestamp: data[id].timestamp || 0

                });

            }

        } else {

            console.log('No notifications found');

        }

        // Latest first
        notifications.sort((a, b) => {
            return b.timestamp - a.timestamp;
        });

        // Pagination
        const totalNotifications = notifications.length;

        const totalPages = Math.ceil(totalNotifications / limit);

        const paginatedNotifications = notifications.slice(
            startIndex,
            startIndex + limit
        );

        console.log('Total Notifications:', totalNotifications);

        // Render Page
        res.render('admin-scheme', {

            notifications: paginatedNotifications,

            currentPage: page,

            totalPages

        });

    } catch (error) {

        console.log('==============================');
        console.log('ADMIN SCHEME ERROR');
        console.log('==============================');

        console.log(error);

        res.status(500).send(
            'Error fetching notifications from Firebase'
        );

    }

});



// ==========================================
// POST NEW SCHEME
// ==========================================

adminRouter.post('/post-scheme', async (req, res) => {

    try {

        const { text } = req.body;

        // Validation
        if (!text || !text.trim()) {

            return res.status(400).json({

                success: false,

                error: 'Scheme text is required'

            });

        }

        console.log('==============================');
        console.log('POSTING NEW SCHEME');
        console.log('==============================');

        // Unique ID
        const schemeId = Date.now().toString();

        // Firebase Ref
        const newNotificationRef = db.ref(
            `notifications/${schemeId}`
        );

        // Save Data
        await newNotificationRef.set({

            text: text.trim(),

            timestamp: Date.now()

        });

        console.log('Scheme Posted Successfully');

        res.json({

            success: true

        });

    } catch (error) {

        console.log('==============================');
        console.log('POST SCHEME ERROR');
        console.log('==============================');

        console.log(error);

        res.status(500).json({

            success: false,

            error: 'Failed to post notification'

        });

    }

});



// ==========================================
// DELETE SCHEME
// ==========================================

adminRouter.delete('/delete-scheme/:id', async (req, res) => {

    try {

        const { id } = req.params;

        console.log('==============================');
        console.log('DELETING SCHEME');
        console.log('Scheme ID:', id);
        console.log('==============================');

        // Firebase Ref
        const notificationRef = db.ref(
            `notifications/${id}`
        );

        // Delete
        await notificationRef.remove();

        console.log('Scheme Deleted Successfully');

        res.json({

            success: true

        });

    } catch (error) {

        console.log('==============================');
        console.log('DELETE SCHEME ERROR');
        console.log('==============================');

        console.log(error);

        res.status(500).json({

            success: false,

            error: 'Failed to delete notification'

        });

    }

});

adminRouter.get('/dashboard-data', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 1;
        const now = new Date();

        // ===== FETCH USERS =====
        const usersSnap = await db.ref('users').get();
        let totalUsers = 0;

        if (usersSnap.exists()) {
            const users = usersSnap.val();
            totalUsers = Object.keys(users).length;
        }

        // ===== FETCH COUPONS (SCANNED DATA) =====
        const couponsSnap = await db.ref('coupons').get();

        let totalQR = 0;
        let totalPoints = 0;
        let userMap = {};

        if (couponsSnap.exists()) {
            const coupons = Object.values(couponsSnap.val());

            coupons.forEach(c => {
                if (!c.dateScanned) return;

                const scanDate = new Date(c.dateScanned);
                const diffDays = (now - scanDate) / (1000 * 60 * 60 * 24);

                if (diffDays <= days) {
                    totalQR++;
                    const pts = Number(c.points || 0);
                    totalPoints += pts;

                    const mobile = c.mobileNumber || "Unknown";

                    if (!userMap[mobile]) userMap[mobile] = 0;
                    userMap[mobile] += pts;
                }
            });
        }

// ===== TOP USERS =====

const usersData = usersSnap.exists()
    ? usersSnap.val()
    : {};

const topUsers = Object.entries(userMap)
    .map(([mobileNumber, points]) => {

        let name = "Unknown";

        if (usersData[mobileNumber]) {

            name =
                usersData[mobileNumber].name ||
                usersData[mobileNumber].fullName ||
                usersData[mobileNumber].userName ||
                "Unknown";
        }

        return {
            mobileNumber,
            name,
            points
        };

    })
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);

res.json({
    success: true,
    totalUsers,
    totalQR,
    totalPoints,
    topUsers
});

} catch (error) {

    console.error("Dashboard Error:", error);

    res.status(500).json({
        success: false
    });

}
});

adminRouter.get("/bills", async (req, res) => {

    try {

        const snapshot = await db.ref("coupons").get();
        const billSnap = await db.ref("bills").get();

        let coupons = [];

        if (snapshot.exists()) {
            coupons = Object.values(snapshot.val());
        }

        let billData =
            billSnap.exists()
            ? billSnap.val()
            : {};

        let monthlyData = {};

        coupons.forEach(c => {

            if (!c.dateScanned) return;

            const date = new Date(c.dateScanned);

            const monthKey =
                `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

            const dayKey =
                date.toISOString().split("T")[0];

            // CREATE MONTH
            if (!monthlyData[monthKey]) {

                monthlyData[monthKey] = {

                    totalScans: 0,

                    amount: 0,

                    status: "UNPAID",

                    days: {}

                };

            }

            // CREATE DAY
            if (!monthlyData[monthKey].days[dayKey]) {

                monthlyData[monthKey].days[dayKey] = 0;

            }

            // 1 QR = ₹1
            monthlyData[monthKey].days[dayKey]++;

            monthlyData[monthKey].totalScans++;

            monthlyData[monthKey].amount =
                monthlyData[monthKey].totalScans;

        });

        // APPLY SAVED STATUS
        Object.keys(monthlyData).forEach(month => {

            if (
                billData[month] &&
                billData[month].status
            ) {

                monthlyData[month].status =
                    billData[month].status;

            }

        });

        console.log(
            "📊 Monthly Data Loaded:",
            monthlyData
        );

        res.render("bills", {
            monthlyData
        });

    } catch (err) {

        console.error("❌ Bills Error:", err);

        res.status(500).send(
            "Error loading bills"
        );

    }

});



// ==========================================
// BILL DETAIL PAGE
// ==========================================

adminRouter.get("/bills/:month", async (req, res) => {

    try {

        const month = req.params.month;

        const snapshot =
            await db.ref("coupons").get();

        let coupons = [];

        if (snapshot.exists()) {

            coupons =
                Object.values(snapshot.val());

        }

        let daily = {};

        coupons.forEach(c => {

            if (!c.dateScanned) return;

            const date =
                new Date(c.dateScanned);

            const monthKey =
                `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

            if (monthKey !== month) return;

            const day =
                date.toISOString().split("T")[0];

            if (!daily[day]) {

                daily[day] = 0;

            }

            daily[day]++;

        });

        res.render("bill-detail", {

            month,

            daily

        });

    } catch (err) {

        console.error(err);

        res.status(500).send("Error");

    }

});



// ==========================================
// WITHDRAW ROUTE
// ==========================================

adminRouter.post("/withdraw/:month", async (req, res) => {

    try {

        console.log(
            "💰 Withdraw request for:",
            req.params.month
        );

        const { password } = req.body;

        const month = req.params.month;

        // PASSWORD CHECK
        if (password !== process.env.WITHDRAW_PASSWORD) {

            return res.json({

                success: false,

                message: "Wrong password"

            });

        }

        // CHECK EXISTING BILL
        const billRef =
            db.ref(`bills/${month}`);

        const snap =
            await billRef.get();

        const current =
            snap.exists()
            ? snap.val()
            : null;

        if (
            current &&
            current.status === "PAID"
        ) {

            return res.json({

                success: false,

                message: "Already withdrawn"

            });

        }

        // =====================================
        // CALCULATE TOTAL SCANS
        // =====================================

        const couponsSnap =
            await db.ref("coupons").get();

        let totalScans = 0;

        if (couponsSnap.exists()) {

            const coupons =
                Object.values(
                    couponsSnap.val()
                );

            coupons.forEach(c => {

                if (!c.dateScanned) return;

                const date =
                    new Date(c.dateScanned);

                const m =
                    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

                if (m === month) {

                    totalScans++;

                }

            });

        }

        // ₹1 PER QR
        const totalAmount =
            totalScans * 1;

        console.log(
            "📊 Total scans:",
            totalScans
        );

        console.log(
            "💰 Total payout amount:",
            totalAmount
        );

        // NO DATA
        if (totalAmount <= 0) {

            return res.json({

                success: false,

                message:
                    "No earnings for this month"

            });

        }

        // =====================================
        // CASHFREE PAYOUT
        // =====================================

        const transferId =
            "TXN_" + Date.now();

        const cashfreePayload = {

            transfer_id: transferId,

            transfer_amount: totalAmount,

            transfer_currency: "INR",

            transfer_mode: "banktransfer",

            beneficiary_details: {

                beneficiary_name:
                    "ADESH JAROLI",

                beneficiary_instrument_details: {

                    bank_account_number:
                        "8989130294",

                    bank_ifsc:
                        "AIRP0000001"

                }

            }

        };

        const response =
            await axios.post(

                "https://api.cashfree.com/payout/transfers",

                cashfreePayload,

                {

                    headers: {

                        "Content-Type":
                            "application/json",

                        "X-Client-Id":
                            CLIENT_ID,

                        "X-Client-Secret":
                            CLIENT_SECRET,

                        "x-api-version":
                            "2024-01-01"

                    }

                }

            );

        console.log(
            "🔥 Cashfree Response:",
            response.data
        );

        // =====================================
        // SAVE BILL STATUS
        // =====================================

        await billRef.set({

            status: "PAID",

            transferId,

            amount: totalAmount,

            totalScans,

            createdAt: Date.now(),

            paidAt: Date.now()

        });

        // =====================================
        // SAVE WITHDRAW LOG
        // =====================================

        await db.ref(
            `withdrawals/${month}/${transferId}`
        ).set({

            transfer_id: transferId,

            transfer_amount: totalAmount,

            total_scans: totalScans,

            status: "SUCCESS",

            created_at: Date.now()

        });

        console.log(
            "✅ Withdraw successful"
        );

        return res.json({

            success: true,

            message: "Payout successful",

            transferId,

            amount: totalAmount

        });

    } catch (err) {

        console.error(
            "❌ Withdraw error:",
            err?.response?.data || err
        );

        return res.json({

            success: false,

            message:
                err?.response?.data?.message ||
                "Cashfree payout failed"

        });

    }

});

  // Export the adminRouter to be used in server.js
module.exports = adminRouter;























