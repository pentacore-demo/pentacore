// server.js
const express = require("express");
const session = require("express-session");
const adminRouter = require("./adminserver");
const userRouter = require('./userserver');
const dealerRouter = require("./dealerserver"); // Import the new dealer server
const path = require('path');


const app = express();



// Configure session globally
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true
}));

// Mount admin router under /admin
app.use('/user', userRouter);
app.use("/admin", adminRouter);
app.use("/dealer", dealerRouter); // Dealer routes

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));



const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});


