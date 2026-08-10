/**
 * Seed a default admin user.
 * Usage: npm run seed:admin
 * Env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME (optional)
 */
require('dotenv').config();
const { supabase } = require('../config/database');
const { hashPassword } = require('./generateToken');

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@jobportal.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const full_name = process.env.ADMIN_NAME || 'System Admin';

  const { data: existing } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    console.log(`Admin already exists: ${existing.email} (${existing.role})`);
    process.exit(0);
  }

  const password_hash = await hashPassword(password);
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      email,
      password_hash,
      full_name,
      role: 'admin',
      is_email_verified: true,
    })
    .select('id, email, full_name, role')
    .single();

  if (error) {
    console.error('Failed to seed admin:', error.message);
    process.exit(1);
  }

  console.log('Admin created successfully:');
  console.log(data);
  console.log(`Login with: ${email} / ${password}`);
  process.exit(0);
}

seedAdmin();
