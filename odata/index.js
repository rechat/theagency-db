const express = require('express')
const metadata = require('./metadata')
const auth = require('./auth')
const property = require('./resources/property')
const member = require('./resources/member')
const office = require('./resources/office')

const router = express.Router()

// OData headers middleware
router.use((req, res, next) => {
  res.set('OData-Version', '4.0')
  next()
})

// Service document (root)
router.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`
  res.json({
    '@odata.context': `${baseUrl}/$metadata`,
    value: [
      { name: 'Property', kind: 'EntitySet', url: 'Property' },
      { name: 'Member', kind: 'EntitySet', url: 'Member' },
      { name: 'Office', kind: 'EntitySet', url: 'Office' }
    ]
  })
})

// Metadata endpoint
router.get('/\\$metadata', metadata.handler)

// Token endpoint (no auth required)
router.post('/token', express.urlencoded({ extended: true }), auth.tokenHandler)

// Auth middleware for all other routes
router.use(auth.middleware)

// Property routes
router.get('/Property', property.list)
router.get('/Property\\(:key\\)', property.get)

// Member routes
router.get('/Member', member.list)
router.get('/Member\\(:key\\)', member.get)

// Office routes
router.get('/Office', office.list)
router.get('/Office\\(:key\\)', office.get)

// Error handler
router.use((err, req, res, next) => {
  console.error('OData Error:', err.message)
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'ServerError',
      message: err.message
    }
  })
})

module.exports = router
