// dashboard.js - For Dashboard Page

document.addEventListener('DOMContentLoaded', function() {

    // Dynamic wallet balance or other elements can be manipulated here
    const walletBalanceElement = document.querySelector('.wallet p');

    // Example: simulate updating the wallet balance (this could be dynamic from the backend)
    function updateWalletBalance(newBalance) {
        walletBalanceElement.textContent = `Your Wallet Balance: $${newBalance}`;
    }

    // Simulating balance change for demonstration (you can replace this with backend data)
    setTimeout(() => {
        updateWalletBalance(200); // After 3 seconds, update the balance to $200
    }, 3000);  // Simulated delay (3 seconds)

    // Logout functionality - no action needed here, since it's handled by the logout button in HTML
    // If you want to handle actions after logout, you can add JavaScript here
    const logoutButton = document.querySelector('.logout-btn');
    logoutButton.addEventListener('click', function() {
        // Optionally, you can add a confirmation or message before logging out
        console.log("Logging out...");
    });

});
