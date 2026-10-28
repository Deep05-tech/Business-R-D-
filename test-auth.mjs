import { AuthStore } from "./src/auth/authStore.js";

const auth = new AuthStore();
await auth.initialize();
const res = await auth.authenticate('admin', 'admin123');
if (res?.token) {
  console.log('Token obtained:', res.token.substring(0, 20) + '...');
  const fetch = (await import('node-fetch')).default;
  const response = await fetch('http://localhost:3000/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + res.token
    },
    body: JSON.stringify({ websiteUrl: 'https://www.venuswomenshospital.com' })
  });
  const data = await response.json();
  console.log('API response:', JSON.stringify(data, null, 2));
} else {
  console.log('Auth failed');
}