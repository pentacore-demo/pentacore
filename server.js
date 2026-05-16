// server.js
require("dotenv").config();

const express = require("express");
const adminRouter = require("./adminserver");
const userRouter = require('./userserver');
const dealerRouter = require("./dealerserver"); // Import the new dealer server
const path = require('path');


const app = express();




// Mount admin router under /admin
app.use('/user', userRouter);
app.use("/admin", adminRouter);
app.use("/dealer", dealerRouter); // Dealer routes

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

// Homepage Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pentacore.html'));
});

app.get('/request-demo', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'request-demo.html'));
});

app.get('/about-us', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'about-us.html'));
});

app.get('/pricing', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pricing.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});


