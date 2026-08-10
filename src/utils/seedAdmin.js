require('dotenv').config();
const { query, pool } = require('../config/database');
const { hashPassword } = require('./generateToken');

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@jobportal.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const full_name = process.env.ADMIN_NAME || 'System Admin';

  const existing = await query('SELECT id, email, role FROM profiles WHERE email = $1', [email]);
  if (existing.rows[0]) {
    console.log(`Admin already exists: ${existing.rows[0].email} (${existing.rows[0].role})`);
    await pool.end();
    process.exit(0);
  }

  const password_hash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO profiles (email, password_hash, full_name, role, is_email_verified)
     VALUES ($1, $2, $3, 'admin', true)
     RETURNING id, email, full_name, role`,
    [email, password_hash, full_name]
  );

  console.log('Admin created successfully:');
  console.log(rows[0]);
  console.log(`Login with: ${email} / ${password}`);
  await pool.end();
  process.exit(0);
}

seedAdmin().catch(async (err) => {
  console.error('Failed to seed admin:', err.message);
  await pool.end();
  process.exit(1);
});
