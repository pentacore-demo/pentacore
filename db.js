const admin = require('firebase-admin');

// Prevent multiple initialization
if (!admin.apps.length) {
    const serviceAccount = require("./fir-c1b0e-firebase-adminsdk-fbsvc-ba4d8926e8.json");

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),

        // ⚠️ MUST MATCH serviceAccount.project_id
        databaseURL: "https://fir-c1b0e-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}


const db = admin.database();

module.exports = db;