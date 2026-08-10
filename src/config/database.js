const { Pool } = require('pg');
require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('Warning: DATABASE_URL is missing. Copy .env.example to .env.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

const query = async (text, params = []) => {
  return pool.query(text, params);
};

const getClient = async () => pool.connect();

module.exports = { pool, query, getClient };
