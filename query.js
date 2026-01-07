#!/usr/bin/env node

const db = require('./db')

function formatMs(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

async function main() {
  const args = process.argv.slice(2)
  const sqlText = args.join(' ')

  if (!sqlText) {
    console.error('Usage: node query.js <SQL query>')
    console.error('Example: node query.js SELECT TOP 5 MLSNUMBER, CITY FROM idc_agy.AGY_CMNCMN_VW')
    process.exit(1)
  }

  const totalStart = performance.now()

  try {
    const connectStart = performance.now()
    await db.connect()
    const connectTime = performance.now() - connectStart

    const queryStart = performance.now()
    const result = await db.query(sqlText)
    const queryTime = performance.now() - queryStart

    if (result.recordset && result.recordset.length > 0) {
      // Print column headers
      const columns = Object.keys(result.recordset[0])
      console.log(columns.join('\t'))
      console.log(columns.map(() => '---').join('\t'))

      // Print rows
      result.recordset.forEach(row => {
        const values = columns.map(col => {
          const val = row[col]
          if (val === null) return 'NULL'
          if (val instanceof Date) return val.toISOString()
          return String(val)
        })
        console.log(values.join('\t'))
      })

      console.log(`\n(${result.recordset.length} rows)`)
    } else {
      console.log('Query executed successfully. No rows returned.')
      if (result.rowsAffected) {
        console.log(`Rows affected: ${result.rowsAffected}`)
      }
    }

    const totalTime = performance.now() - totalStart

    console.log(`\n--- Timing ---`)
    console.log(`Connect: ${formatMs(connectTime)}`)
    console.log(`Query:   ${formatMs(queryTime)}`)
    console.log(`Total:   ${formatMs(totalTime)}`)

  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  } finally {
    await db.close()
  }
}

main()
