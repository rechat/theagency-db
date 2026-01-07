const express = require('express')
const db = require('./db')

require('dotenv').config()

const baseUrl = process.env.BASE_URL || 'https://www.theagencyre.com'

function formatMs(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const listing = async (req, res) => {
  const requestStart = performance.now()
  const mlsnumber = req.params.mlsnumber?.split('-').pop()

  if (!mlsnumber || mlsnumber.length < 4) {
    res.status(400).end()
    return
  }

  try {
    const queryStart = performance.now()
    const result = await db.query(
      `SELECT TOP 1 LISTINGDETAILURL
       FROM idc_agy.AGY_CMNCMN_VW
       WHERE MLSNUMBER LIKE @mlsnumber OR IDCMLSNUMBER LIKE @mlsnumber`,
      { mlsnumber: `%${mlsnumber}` }
    )
    const queryTime = performance.now() - queryStart

    const totalTime = performance.now() - requestStart

    if (result.recordset.length > 0 && result.recordset[0].LISTINGDETAILURL) {
      const url = baseUrl + result.recordset[0].LISTINGDETAILURL
      console.log(`Found ${mlsnumber} -> ${url} [query: ${formatMs(queryTime)}, total: ${formatMs(totalTime)}]`)
      res.redirect(url)
    } else {
      console.log(`Not Found ${mlsnumber} [query: ${formatMs(queryTime)}, total: ${formatMs(totalTime)}]`)
      res.status(404).end()
    }
  } catch (err) {
    const totalTime = performance.now() - requestStart
    console.error(`Query error: ${err.message} [total: ${formatMs(totalTime)}]`)
    res.status(500).end()
  }
}

const health = (req, res) => {
  if (db.isConnected()) {
    res.status(200).end()
  } else {
    res.status(503).end()
  }
}

const app = express()
app.get('/listing/:mlsnumber', listing)
app.get('/health', health)

const startTime = performance.now()
console.log('Starting server...')

db.connect()
  .then(() => {
    const connectTime = performance.now() - startTime
    console.log(`Database connected [${formatMs(connectTime)}]`)

    app.listen(process.env.PORT || 8080, () => {
      const totalTime = performance.now() - startTime
      console.log(`Server listening on port ${process.env.PORT || 8080} [startup: ${formatMs(totalTime)}]`)
    })
  })
  .catch((err) => {
    console.error('Failed to start:', err.message)
    process.exit(1)
  })
