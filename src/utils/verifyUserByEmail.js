require('dotenv').config();
const { pool, query } = require('../config/database');

async function main() {
  const email = (process.argv[2] || '').toLowerCase();
  if (!email) {
    console.error('Usage: node src/utils/verifyUserByEmail.js user@email.com');
    process.exit(1);
  }

  const { rows } = await query(
    `UPDATE users
     SET is_email_verified = true
     WHERE email = $1
     RETURNING id, email, full_name, role, is_email_verified`,
    [email]
  );

  if (!rows[0]) {
    console.error('User not found:', email);
    await pool.end();
    process.exit(1);
  }

  console.log('Verified:', rows[0]);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err.message);
  await pool.end();
  process.exit(1);
});
