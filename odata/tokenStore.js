/**
 * PostgreSQL Token Store
 * Stores OAuth tokens in PostgreSQL for persistence and horizontal scaling
 */

const { Pool } = require('pg')

let pool = null

const TOKEN_TABLE = 'oauth_tokens'
const REFRESH_TOKEN_TABLE = 'oauth_refresh_tokens'

async function init() {
  if (!process.env.PG_CONNECTION_STRING) {
    console.error('PG_CONNECTION_STRING not set - PostgreSQL is required for token storage')
    return false
  }

  pool = new Pool({
    connectionString: process.env.PG_CONNECTION_STRING,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: false }
  })

  // Create tables if they don't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TOKEN_TABLE} (
      access_token VARCHAR(64) PRIMARY KEY,
      client_id VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${REFRESH_TOKEN_TABLE} (
      refresh_token VARCHAR(64) PRIMARY KEY,
      client_id VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Create indexes for cleanup queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tokens_expires_at ON ${TOKEN_TABLE} (expires_at)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON ${REFRESH_TOKEN_TABLE} (expires_at)
  `)

  console.log('PostgreSQL token store initialized')
  return true
}

async function saveToken(accessToken, clientId, expiresAt) {
  await pool.query(
    `INSERT INTO ${TOKEN_TABLE} (access_token, client_id, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (access_token) DO UPDATE SET expires_at = $3`,
    [accessToken, clientId, new Date(expiresAt)]
  )
}

async function getToken(accessToken) {
  const result = await pool.query(
    `SELECT client_id, expires_at FROM ${TOKEN_TABLE} WHERE access_token = $1`,
    [accessToken]
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    clientId: row.client_id,
    expiresAt: new Date(row.expires_at).getTime()
  }
}

async function deleteToken(accessToken) {
  await pool.query(
    `DELETE FROM ${TOKEN_TABLE} WHERE access_token = $1`,
    [accessToken]
  )
}

async function saveRefreshToken(refreshToken, clientId, expiresAt) {
  await pool.query(
    `INSERT INTO ${REFRESH_TOKEN_TABLE} (refresh_token, client_id, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (refresh_token) DO UPDATE SET expires_at = $3`,
    [refreshToken, clientId, new Date(expiresAt)]
  )
}

async function getRefreshToken(refreshToken) {
  const result = await pool.query(
    `SELECT client_id, expires_at FROM ${REFRESH_TOKEN_TABLE} WHERE refresh_token = $1`,
    [refreshToken]
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    clientId: row.client_id,
    expiresAt: new Date(row.expires_at).getTime()
  }
}

async function deleteRefreshToken(refreshToken) {
  await pool.query(
    `DELETE FROM ${REFRESH_TOKEN_TABLE} WHERE refresh_token = $1`,
    [refreshToken]
  )
}

async function cleanup() {
  if (!pool) return

  const now = new Date()
  await pool.query(`DELETE FROM ${TOKEN_TABLE} WHERE expires_at < $1`, [now])
  await pool.query(`DELETE FROM ${REFRESH_TOKEN_TABLE} WHERE expires_at < $1`, [now])
}

async function close() {
  if (pool) {
    await pool.end()
    pool = null
  }
}

module.exports = {
  init,
  saveToken,
  getToken,
  deleteToken,
  saveRefreshToken,
  getRefreshToken,
  deleteRefreshToken,
  cleanup,
  close
}
