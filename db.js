const { Client } = require('ssh2')
const sql = require('mssql')
const net = require('net')

require('dotenv').config()

const sshConfig = {
  host: process.env.SSH_HOST,
  port: parseInt(process.env.SSH_PORT),
  username: process.env.SSH_USERNAME,
  password: process.env.SSH_PASSWORD,
  tryKeyboard: true,
  keepaliveInterval: 10000,
  keepaliveCountMax: 3,
  readyTimeout: 30000
}

const dbConfig = {
  user: process.env.MSSQL_USERNAME,
  password: process.env.MSSQL_PASSWORD,
  server: '127.0.0.1',
  port: 1433,
  database: process.env.MSSQL_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  connectionTimeout: 30000,
  requestTimeout: 30000
}

const remoteDbHost = process.env.MSSQL_HOST
const remoteDbPort = parseInt(process.env.MSSQL_PORT)

let pool = null
let sshClient = null
let tunnelServer = null
let connected = false
let reconnecting = false

function formatMs(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

async function cleanup() {
  connected = false

  if (pool) {
    try {
      await pool.close()
    } catch (e) {
      // ignore
    }
    pool = null
  }

  if (tunnelServer) {
    try {
      tunnelServer.close()
    } catch (e) {
      // ignore
    }
    tunnelServer = null
  }

  if (sshClient) {
    try {
      sshClient.end()
    } catch (e) {
      // ignore
    }
    sshClient = null
  }
}

async function createTunnel() {
  return new Promise((resolve, reject) => {
    sshClient = new Client()

    sshClient.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      finish([process.env.SSH_PASSWORD])
    })

    sshClient.on('ready', () => {
      console.log('SSH connection established')

      tunnelServer = net.createServer((sock) => {
        sshClient.forwardOut(
          sock.remoteAddress,
          sock.remotePort,
          remoteDbHost,
          remoteDbPort,
          (err, stream) => {
            if (err) {
              sock.end()
              return
            }
            sock.pipe(stream).pipe(sock)
          }
        )
      })

      tunnelServer.listen(1433, '127.0.0.1', () => {
        console.log('SSH tunnel listening on 127.0.0.1:1433')
        resolve()
      })

      tunnelServer.on('error', (err) => {
        console.error('Tunnel server error:', err.message)
        handleDisconnect('tunnel error')
      })
    })

    sshClient.on('error', (err) => {
      console.error('SSH Error:', err.message)
      if (!connected) {
        reject(err)
      } else {
        handleDisconnect('ssh error')
      }
    })

    sshClient.on('close', () => {
      console.log('SSH connection closed')
      if (connected) {
        handleDisconnect('ssh closed')
      }
    })

    sshClient.on('end', () => {
      console.log('SSH connection ended')
      if (connected) {
        handleDisconnect('ssh ended')
      }
    })

    sshClient.connect(sshConfig)
  })
}

async function handleDisconnect(reason) {
  if (reconnecting) return

  console.log(`Connection lost (${reason}), will reconnect...`)
  reconnecting = true

  await cleanup()

  // Wait before reconnecting
  await new Promise(r => setTimeout(r, 3000))

  try {
    await connect()
    console.log('Reconnected successfully')
  } catch (err) {
    console.error('Reconnection failed:', err.message)
    // Try again in 5 seconds
    setTimeout(() => {
      reconnecting = false
      handleDisconnect('retry')
    }, 5000)
  }
}

async function connect() {
  if (connected && pool) {
    return pool
  }

  reconnecting = true

  try {
    await createTunnel()
    await new Promise(r => setTimeout(r, 1000))

    console.log('Connecting to MSSQL...')
    pool = await sql.connect(dbConfig)
    console.log('Connected to MSSQL!')

    pool.on('error', (err) => {
      console.error('MSSQL pool error:', err.message)
      handleDisconnect('pool error')
    })

    connected = true
    reconnecting = false

    return pool
  } catch (err) {
    reconnecting = false
    throw err
  }
}

async function query(sqlText, params = {}) {
  // Wait for reconnection if in progress
  let attempts = 0
  while (reconnecting && attempts < 30) {
    await new Promise(r => setTimeout(r, 1000))
    attempts++
  }

  if (!pool || !connected) {
    throw new Error('Database not connected. Call connect() first.')
  }

  const request = pool.request()

  for (const [key, value] of Object.entries(params)) {
    request.input(key, value)
  }

  try {
    return await request.query(sqlText)
  } catch (err) {
    // Check if it's a connection error
    if (err.code === 'ESOCKET' || err.code === 'ECONNRESET' || err.code === 'ECONNCLOSED') {
      console.error('Query failed due to connection error, reconnecting...')
      handleDisconnect('query error')
      throw new Error('Connection lost, please retry')
    }
    throw err
  }
}

async function close() {
  await cleanup()
}

function getPool() {
  return pool
}

function isConnected() {
  return connected && !reconnecting
}

module.exports = {
  connect,
  query,
  close,
  getPool,
  isConnected,
  sql
}
