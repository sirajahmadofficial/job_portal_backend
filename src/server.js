require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 5000;

const requiredEnv = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(`Warning: Missing environment variables: ${missing.join(', ')}`);
  console.warn('Copy .env.example to .env and fill in the values.');
}

app.listen(PORT, () => {
  console.log(`Job Portal API listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});
