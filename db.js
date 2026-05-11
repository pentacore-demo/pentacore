<<<<<<< HEAD
const admin = require('firebase-admin');

// Prevent multiple initialization
if (!admin.apps.length) {
    const serviceAccount = require("./fir-c1b0e-firebase-adminsdk-fbsvc-052b9da7d2.json");

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),

        // ⚠️ MUST MATCH serviceAccount.project_id
        databaseURL: "https://fir-c1b0e-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}


const db = admin.database();

=======
const admin = require('firebase-admin');

// Prevent multiple initialization
if (!admin.apps.length) {
    const serviceAccount = require("./fir-c1b0e-firebase-adminsdk-fbsvc-052b9da7d2.json");

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),

        // ⚠️ MUST MATCH serviceAccount.project_id
        databaseURL: "https://fir-c1b0e-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}


const db = admin.database();

>>>>>>> fc30a8b4245210df0553ef4b1594fd34e3ed29ae
module.exports = db;
