require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runSchema() {
  const schemaPath = path.join(__dirname, '../../supabase/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  console.log('Running schema against DATABASE_URL...');
  await pool.query(sql);
  console.log('Schema applied successfully.');
  await pool.end();
  process.exit(0);
}

runSchema().catch(async (err) => {
  console.error('Schema failed:', err.message);
  await pool.end();
  process.exit(1);
});
