// script.js - For Login Page

// DOMContentLoaded ensures the page is fully loaded before executing the code
document.addEventListener('DOMContentLoaded', function() {

    // Show loading spinner during form submission
    const form = document.querySelector('form');
    form.addEventListener('submit', function() {
        document.body.style.cursor = 'wait';  // Show wait cursor when the form is submitted
        // Optionally, you can display a loading spinner here if desired
    });

    // Handle form validation or other actions if needed
    // For example, you can show an alert if the user tries to submit an empty form
    form.addEventListener('submit', function(event) {
        const username = document.querySelector('input[name="username"]');
        const password = document.querySelector('input[name="password"]');

        if (!username.value || !password.value) {
            event.preventDefault();  // Prevent form submission if inputs are empty
            alert('Please fill in both fields!');
        }
    });
});

