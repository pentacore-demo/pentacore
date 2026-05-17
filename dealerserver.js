const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const admin = require("firebase-admin");
const https = require("https");
const rateLimit = require("express-rate-limit");

const RedisStore = require("connect-redis").default;
const { createClient } = require("redis");

require("dotenv").config();

const dealerRouter = express.Router();

// ========================================
// FIREBASE INIT
// ========================================

const serviceAccount = require("./fir-c1b0e-firebase-adminsdk-fbsvc-052b9da7d2.json");

if (!admin.apps.length) {

    admin.initializeApp({

        credential: admin.credential.cert(serviceAccount),

        databaseURL: process.env.FIREBASE_DATABASE_URL

    });

}

const db = admin.database();

// ========================================
// REDIS CLIENT
// ========================================

const redisClient = createClient({

    url: process.env.REDIS_URL

});

redisClient.connect().catch(console.error);

// ========================================
// TRUST PROXY
// ========================================



// ========================================
// SESSION CONFIG
// ========================================

dealerRouter.use(

    session({

        store: new RedisStore({

            client: redisClient

        }),

        secret: process.env.SESSION_SECRET,

        resave: false,

        saveUninitialized: false,

        rolling: true,

        name: "dealer.sid",

        cookie: {

            secure:
                process.env.NODE_ENV === "production",

            httpOnly: true,

            sameSite: "lax",

            maxAge:
                1000 * 60 * 60 * 24 * 30

        }

    })

);

// ========================================
// BODY PARSER
// ========================================

dealerRouter.use(bodyParser.urlencoded({

    extended: true,

    limit: "10mb"

}));

dealerRouter.use(bodyParser.json({

    limit: "10mb"

}));

// ========================================
// LOGIN RATE LIMITER
// ========================================

const loginLimiter = rateLimit({

    windowMs: 15 * 60 * 1000,

    max: 10,

    message: "Too many login attempts. Try again later.",

    standardHeaders: true,

    legacyHeaders: false

});

// ========================================
// KEEP SERVER ALIVE
// ========================================

function keepServerAlive() {

    const options = {

        hostname: "pentacore-demo.in",

        path: "/dealer/login",

        method: "GET"

    };

    const req = https.request(options, () => {});

    req.on("error", (error) => {

        console.error(

            "Keep Alive Error:",
            error.message

        );

    });

    req.end();

}

setInterval(

    keepServerAlive,

    12 * 60 * 1000

);

// ========================================
// AUTH MIDDLEWARE
// ========================================

function isDealerAuthenticated(

    req,
    res,
    next

) {

    if (

        req.session &&
        req.session.isLoggedIn &&
        req.session.userId

    ) {

        return next();

    }

    return res.redirect("/dealer/login");

}

// ========================================
// LOGIN PAGE
// ========================================

dealerRouter.get("/login", (req, res) => {

    if (

        req.session &&
        req.session.isLoggedIn

    ) {

        return res.redirect(
            "/dealer/dealer-dashboard"
        );

    }

    res.sendFile(

        path.join(
            __dirname,
            "views",
            "dealer-login.html"
        )

    );

});

// ========================================
// LOGIN POST
// ========================================

dealerRouter.post(

    "/login",

    loginLimiter,

    async (req, res) => {

        try {

            const {

                userId,
                password

            } = req.body;

            if (

                !userId ||
                !password

            ) {

                return res
                    .status(400)
                    .send(
                        "User ID and password required."
                    );

            }

            const dealerRef = db.ref(

                `dealers/${userId}`

            );

            const snapshot =
                await dealerRef.get();

            if (!snapshot.exists()) {

                return res
                    .status(401)
                    .send(
                        "Invalid User ID or password."
                    );

            }

            const dealerData =
                snapshot.val();

            if (

                dealerData.password !== password

            ) {

                return res
                    .status(401)
                    .send(
                        "Invalid User ID or password."
                    );

            }

            // SESSION REGENERATION
            req.session.regenerate(

                async (err) => {

                    if (err) {

                        console.error(err);

                        return res
                            .status(500)
                            .send(
                                "Login failed."
                            );

                    }

                    req.session.isLoggedIn = true;

                    req.session.userId = userId;

                    req.session.createdAt =
                        Date.now();

                    req.session.save((err) => {

                        if (err) {

                            console.error(err);

                            return res
                                .status(500)
                                .send(
                                    "Session save failed."
                                );

                        }

                        return res.redirect(
                            "/dealer/dealer-dashboard"
                        );

                    });

                }

            );

        } catch (error) {

            console.error(

                "Dealer Login Error:",

                error

            );

            return res
                .status(500)
                .send(
                    "Internal Server Error."
                );

        }

    }

);

// ========================================
// DEALER DASHBOARD
// ========================================

dealerRouter.get(

    "/dealer-dashboard",

    isDealerAuthenticated,

    (req, res) => {

        res.sendFile(

            path.join(

                __dirname,
                "views",
                "dealer-dashboard.html"

            )

        );

    }

);

// ========================================
// GET QR DETAILS
// ========================================

dealerRouter.get(

    "/get-qr-details/:qrCode",

    isDealerAuthenticated,

    async (req, res) => {

        try {

            const qrCode =
                req.params.qrCode;

            const couponRef =
                db.ref("coupons");

            const snapshot =
                await couponRef.get();

            if (!snapshot.exists()) {

                return res.status(404).json({

                    success: false,

                    message:
                        "No coupon data found."

                });

            }

            const couponData =
                snapshot.val();

            const qrCodeDetails =
                Object.values(couponData)
                .find(

                    item =>
                        item.qrCode === qrCode

                );

            if (!qrCodeDetails) {

                return res.json({

                    success: false,

                    message:
                        "QR code not found."

                });

            }

            return res.json({

                success: true,

                qrCode:
                    qrCodeDetails.qrCode,

                scannedBy:
                    qrCodeDetails.fullName,

                mobileNumber:
                    qrCodeDetails.mobileNumber,

                qrBatch:
                    qrCodeDetails.qrBatch ||
                    "N/A",

                scanDate:
                    qrCodeDetails.dateScanned,

                transactionAmount:
                    qrCodeDetails.points

            });

        } catch (error) {

            console.error(

                "QR Fetch Error:",

                error

            );

            return res.status(500).json({

                success: false,

                message:
                    "Internal Server Error."

            });

        }

    }

);

// ========================================
// LOGOUT
// ========================================

dealerRouter.post(

    "/logout",

    isDealerAuthenticated,

    (req, res) => {

        req.session.destroy((err) => {

            if (err) {

                console.error(err);

                return res
                    .status(500)
                    .send(
                        "Logout failed."
                    );

            }

            res.clearCookie("dealer.sid");

            return res.redirect(
                "/dealer/login"
            );

        });

    }

);

module.exports = dealerRouter;
