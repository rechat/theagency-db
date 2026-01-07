#!/usr/bin/env node

const db = require('./db')


async function main() {
  const args = process.argv.slice(2)
  const sqlText = args.join(' ')

  if (!sqlText) {
    console.error('Usage: node query.js <SQL query>')
    console.error('Example: node query.js SELECT TOP 5 MLSNUMBER, CITY FROM idc_agy.AGY_CMNCMN_VW')
    process.exit(1)
  }

  try {
    await db.connect()
    const result = await db.query(sqlText)

    if (result.recordset && result.recordset.length > 0) {
      console.log(JSON.stringify(result.recordset, null, 2))
    } else {
      console.log('[]')
    }

  } catch (err) {
    console.error(JSON.stringify({ error: err.message }))
    process.exit(1)
  } finally {
    await db.close()
  }
}

main()
