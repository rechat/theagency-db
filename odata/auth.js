const crypto = require('crypto')
const tokenStore = require('./tokenStore')

require('dotenv').config()

const CLIENT_ID = process.env.OAUTH_CLIENT_ID
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET
const TOKEN_EXPIRY = 3600 // 1 hour in seconds
const REFRESH_TOKEN_EXPIRY = 86400 * 30 // 30 days in seconds

function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

async function init() {
  const enabled = await tokenStore.init()
  if (!enabled) {
    throw new Error('PostgreSQL token store is required. Set PG_CONNECTION_STRING in .env')
  }
}

async function tokenHandler(req, res) {
  const { grant_type, client_id, client_secret, refresh_token } = req.body

  // Handle refresh token grant
  if (grant_type === 'refresh_token') {
    return handleRefreshToken(req, res, refresh_token)
  }

  // Validate grant type
  if (grant_type !== 'client_credentials') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Supported grant types: client_credentials, refresh_token'
    })
  }

  // Validate credentials
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({
      error: 'server_error',
      error_description: 'OAuth not configured. Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in .env'
    })
  }

  if (client_id !== CLIENT_ID || client_secret !== CLIENT_SECRET) {
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Invalid client credentials'
    })
  }

  // Generate tokens
  const accessToken = generateToken()
  const refreshToken = generateToken()
  const accessExpiresAt = Date.now() + (TOKEN_EXPIRY * 1000)
  const refreshExpiresAt = Date.now() + (REFRESH_TOKEN_EXPIRY * 1000)

  // Store tokens
  await tokenStore.saveToken(accessToken, client_id, accessExpiresAt)
  await tokenStore.saveRefreshToken(refreshToken, client_id, refreshExpiresAt)

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_EXPIRY,
    refresh_token: refreshToken
  })
}

async function handleRefreshToken(req, res, refreshToken) {
  if (!refreshToken) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'refresh_token is required'
    })
  }

  const tokenData = await tokenStore.getRefreshToken(refreshToken)

  if (!tokenData) {
    return res.status(401).json({
      error: 'invalid_grant',
      error_description: 'Invalid refresh token'
    })
  }

  if (tokenData.expiresAt < Date.now()) {
    await tokenStore.deleteRefreshToken(refreshToken)
    return res.status(401).json({
      error: 'invalid_grant',
      error_description: 'Refresh token has expired'
    })
  }

  // Generate new access token (keep same refresh token)
  const accessToken = generateToken()
  const accessExpiresAt = Date.now() + (TOKEN_EXPIRY * 1000)

  await tokenStore.saveToken(accessToken, tokenData.clientId, accessExpiresAt)

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_EXPIRY,
    refresh_token: refreshToken
  })
}

async function middleware(req, res, next) {
  // Skip auth if not configured (development mode)
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('OAuth not configured - running without authentication')
    return next()
  }

  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'Unauthorized',
        message: 'Missing or invalid Authorization header. Use: Authorization: Bearer <token>'
      }
    })
  }

  const token = authHeader.slice(7)

  const tokenData = await tokenStore.getToken(token)

  if (!tokenData) {
    return res.status(401).json({
      error: {
        code: 'Unauthorized',
        message: 'Invalid or expired token'
      }
    })
  }

  if (tokenData.expiresAt < Date.now()) {
    await tokenStore.deleteToken(token)
    return res.status(401).json({
      error: {
        code: 'Unauthorized',
        message: 'Token has expired'
      }
    })
  }

  // Token is valid
  req.clientId = tokenData.clientId
  next()
}

// Cleanup every 5 minutes
setInterval(async () => {
  await tokenStore.cleanup()
}, 5 * 60 * 1000)

module.exports = {
  init,
  tokenHandler,
  middleware
}
