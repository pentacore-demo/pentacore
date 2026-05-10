document.getElementById('login-form').addEventListener('submit', function(event) {
  event.preventDefault(); // Prevent form submission for now
  
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  // Check if both fields are filled
  if (email && password) {
    console.log('Email:', email);
    console.log('Password:', password);
    // Redirect or further logic can go here
    alert('Login successful! (Simulated)');
  } else {
    alert('Please fill out both fields.');
  }
});
