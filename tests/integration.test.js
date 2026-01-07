/**
 * Integration Tests for OData API Endpoints
 * Tests HTTP endpoints, authentication, and response format
 */

// Set up environment variables BEFORE requiring modules
process.env.OAUTH_CLIENT_ID = 'test-client'
process.env.OAUTH_CLIENT_SECRET = 'test-secret'

const request = require('supertest')
const express = require('express')

// Mock the database module before requiring the router
jest.mock('../db', () => ({
  query: jest.fn(),
  connect: jest.fn().mockResolvedValue(true),
  isConnected: jest.fn().mockReturnValue(true),
  close: jest.fn()
}))

// Mock tokenStore for auth (PostgreSQL-only) with in-memory state for tests
const mockTokens = new Map()
const mockRefreshTokens = new Map()

jest.mock('../odata/tokenStore', () => ({
  init: jest.fn().mockResolvedValue(true),
  saveToken: jest.fn().mockImplementation((token, clientId, expiresAt) => {
    mockTokens.set(token, { clientId, expiresAt })
    return Promise.resolve()
  }),
  getToken: jest.fn().mockImplementation((token) => {
    return Promise.resolve(mockTokens.get(token) || null)
  }),
  deleteToken: jest.fn().mockImplementation((token) => {
    mockTokens.delete(token)
    return Promise.resolve()
  }),
  saveRefreshToken: jest.fn().mockImplementation((token, clientId, expiresAt) => {
    mockRefreshTokens.set(token, { clientId, expiresAt })
    return Promise.resolve()
  }),
  getRefreshToken: jest.fn().mockImplementation((token) => {
    return Promise.resolve(mockRefreshTokens.get(token) || null)
  }),
  deleteRefreshToken: jest.fn().mockImplementation((token) => {
    mockRefreshTokens.delete(token)
    return Promise.resolve()
  }),
  cleanup: jest.fn().mockResolvedValue(),
  close: jest.fn().mockResolvedValue()
}))

const db = require('../db')
const odataRouter = require('../odata')

// Create test app
const app = express()
app.use('/odata', odataRouter)

// Store tokens for tests
let accessToken = null

// Use fake timers to prevent setInterval in auth.js from blocking Jest exit
jest.useFakeTimers()

describe('OData API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('Service Document', () => {
    test('GET /odata/ returns service document', async () => {
      const res = await request(app).get('/odata/')

      expect(res.status).toBe(200)
      expect(res.headers['odata-version']).toBe('4.0')
      expect(res.body['@odata.context']).toContain('$metadata')
      expect(res.body.value).toBeInstanceOf(Array)
      expect(res.body.value).toHaveLength(3)

      const names = res.body.value.map(v => v.name)
      expect(names).toContain('Property')
      expect(names).toContain('Member')
      expect(names).toContain('Office')
    })
  })

  describe('Metadata', () => {
    test('GET /odata/$metadata returns XML CSDL', async () => {
      const res = await request(app).get('/odata/$metadata')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('application/xml')
      expect(res.text).toContain('<?xml')
      expect(res.text).toContain('edmx:Edmx')
      expect(res.text).toContain('EntityType Name="Property"')
      expect(res.text).toContain('EntityType Name="Member"')
      expect(res.text).toContain('EntityType Name="Office"')
    })
  })

  describe('Authentication', () => {
    test('POST /odata/token with valid credentials returns access token', async () => {
      const res = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-secret'
        })

      expect(res.status).toBe(200)
      expect(res.body.access_token).toBeDefined()
      expect(res.body.token_type).toBe('Bearer')
      expect(res.body.expires_in).toBe(3600)
      expect(res.body.refresh_token).toBeDefined()

      accessToken = res.body.access_token
    })

    test('POST /odata/token with invalid credentials returns 401', async () => {
      const res = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'wrong-client',
          client_secret: 'wrong-secret'
        })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('invalid_client')
    })

    test('POST /odata/token with invalid grant type returns 400', async () => {
      const res = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-secret'
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('unsupported_grant_type')
    })

    test('Protected routes require authentication', async () => {
      const res = await request(app).get('/odata/Property')

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('Unauthorized')
    })

    test('Protected routes accept valid Bearer token', async () => {
      // First get a token
      const tokenRes = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-secret'
        })

      const token = tokenRes.body.access_token

      // Mock database response
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
    })
  })

  describe('Property Resource', () => {
    let token

    beforeAll(async () => {
      const tokenRes = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-secret'
        })
      token = tokenRes.body.access_token
    })

    test('GET /odata/Property returns property list', async () => {
      const mockProperties = [
        { IDCPROPERTYID: 'P1', IDCMLSNUMBER: 'MLS1', CITY: 'Los Angeles', IDCLISTPRICE: 500000 },
        { IDCPROPERTYID: 'P2', IDCMLSNUMBER: 'MLS2', CITY: 'Beverly Hills', IDCLISTPRICE: 1000000 }
      ]

      db.query.mockResolvedValueOnce({ recordset: mockProperties })

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body['@odata.context']).toContain('$metadata#Property')
      expect(res.body.value).toBeInstanceOf(Array)
      expect(res.body.value).toHaveLength(2)
      expect(res.body.value[0].ListingKey).toBe('P1')
      expect(res.body.value[0].City).toBe('Los Angeles')
    })

    test('GET /odata/Property with $count returns total count', async () => {
      const mockProperties = [
        { IDCPROPERTYID: 'P1', CITY: 'Los Angeles' }
      ]

      db.query
        .mockResolvedValueOnce({ recordset: mockProperties })
        .mockResolvedValueOnce({ recordset: [{ total: 100 }] })

      const res = await request(app)
        .get('/odata/Property?$count=true')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body['@odata.count']).toBe(100)
    })

    test('GET /odata/Property with $top limits results', async () => {
      db.query.mockResolvedValueOnce({ recordset: [{ IDCPROPERTYID: 'P1' }] })

      const res = await request(app)
        .get('/odata/Property?$top=5')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      // Verify query was called with correct pagination
      expect(db.query).toHaveBeenCalled()
      const queryCall = db.query.mock.calls[0][0]
      expect(queryCall).toContain('FETCH NEXT 5 ROWS ONLY')
    })

    test('GET /odata/Property with $filter filters results', async () => {
      db.query.mockResolvedValueOnce({ recordset: [{ IDCPROPERTYID: 'P1', CITY: 'Los Angeles' }] })

      const res = await request(app)
        .get("/odata/Property?$filter=City eq 'Los Angeles'")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(db.query).toHaveBeenCalled()
      const [query, params] = db.query.mock.calls[0]
      expect(query).toContain('WHERE CITY = @filter0')
      expect(params.filter0).toBe('Los Angeles')
    })

    test('GET /odata/Property with invalid $filter returns error', async () => {
      const res = await request(app)
        .get("/odata/Property?$filter=InvalidField eq 'test'")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(500)
      expect(res.body.error.message).toContain('Unknown field')
    })

    test('GET /odata/Property(key) returns single property', async () => {
      db.query.mockResolvedValueOnce({
        recordset: [{ IDCPROPERTYID: 'P123', CITY: 'Los Angeles', IDCLISTPRICE: 500000 }]
      })

      const res = await request(app)
        .get("/odata/Property('P123')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.ListingKey).toBe('P123')
      expect(res.body['@odata.context']).toContain('$entity')
    })

    test('GET /odata/Property(key) returns 404 for missing property', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get("/odata/Property('NOTFOUND')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NotFound')
    })

    test('GET /odata/Property with $select returns only selected fields', async () => {
      db.query.mockResolvedValueOnce({
        recordset: [{ IDCPROPERTYID: 'P1', CITY: 'Los Angeles' }]
      })

      const res = await request(app)
        .get('/odata/Property?$select=ListingKey,City')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(db.query).toHaveBeenCalled()
      const queryCall = db.query.mock.calls[0][0]
      expect(queryCall).toContain('SELECT IDCPROPERTYID, CITY')
    })

    test('GET /odata/Property with $orderby sorts results', async () => {
      db.query.mockResolvedValueOnce({
        recordset: [{ IDCPROPERTYID: 'P1', IDCLISTPRICE: 1000000 }]
      })

      const res = await request(app)
        .get('/odata/Property?$orderby=ListPrice desc')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(db.query).toHaveBeenCalled()
      const queryCall = db.query.mock.calls[0][0]
      expect(queryCall).toContain('ORDER BY IDCLISTPRICE DESC')
    })
  })

  describe('Member Resource', () => {
    let token

    beforeAll(async () => {
      const tokenRes = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-secret'
        })
      token = tokenRes.body.access_token
    })

    test('GET /odata/Member returns member list', async () => {
      const mockMembers = [
        { AGENTKEY: 1, GIVENNAME: 'John', SURNAME: 'Doe', EMAILADDRESS1: 'john@test.com' }
      ]

      db.query.mockResolvedValueOnce({ recordset: mockMembers })

      const res = await request(app)
        .get('/odata/Member')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body['@odata.context']).toContain('$metadata#Member')
      expect(res.body.value[0].MemberKey).toBe(1)
      expect(res.body.value[0].MemberFirstName).toBe('John')
    })

    test('GET /odata/Member(key) returns single member', async () => {
      db.query.mockResolvedValueOnce({
        recordset: [{ AGENTKEY: 123, GIVENNAME: 'Jane', SURNAME: 'Smith' }]
      })

      const res = await request(app)
        .get('/odata/Member(123)')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.MemberKey).toBe(123)
      expect(res.body.MemberFirstName).toBe('Jane')
    })
  })

  describe('Office Resource', () => {
    let token

    beforeAll(async () => {
      const tokenRes = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-secret'
        })
      token = tokenRes.body.access_token
    })

    test('GET /odata/Office returns office list', async () => {
      const mockOffices = [
        { OFFICEKEY: 1, OFFICENAME: 'Downtown Office', CITY: 'Los Angeles' }
      ]

      db.query.mockResolvedValueOnce({ recordset: mockOffices })

      const res = await request(app)
        .get('/odata/Office')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body['@odata.context']).toContain('$metadata#Office')
      expect(res.body.value[0].OfficeKey).toBe(1)
      expect(res.body.value[0].OfficeName).toBe('Downtown Office')
    })

    test('GET /odata/Office(key) returns single office', async () => {
      db.query.mockResolvedValueOnce({
        recordset: [{ OFFICEKEY: 456, OFFICENAME: 'West Side Office' }]
      })

      const res = await request(app)
        .get('/odata/Office(456)')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.OfficeKey).toBe(456)
    })
  })

  describe('$expand Support', () => {
    let token

    beforeAll(async () => {
      const tokenRes = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-secret'
        })
      token = tokenRes.body.access_token
    })

    test('GET /odata/Property with $expand=ListAgent includes agent data', async () => {
      // Property query
      db.query.mockResolvedValueOnce({
        recordset: [{ IDCPROPERTYID: 'P1', IDCLISTAGENTKEY: 100 }]
      })
      // Agent query for expand
      db.query.mockResolvedValueOnce({
        recordset: [{ AGENTKEY: 100, GIVENNAME: 'John', SURNAME: 'Agent' }]
      })

      const res = await request(app)
        .get('/odata/Property?$expand=ListAgent')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.value[0].ListAgent).toBeDefined()
      expect(res.body.value[0].ListAgent.MemberKey).toBe(100)
      expect(res.body.value[0].ListAgent.MemberFirstName).toBe('John')
    })

    test('GET /odata/Property with $expand=ListOffice includes office data', async () => {
      // Property query
      db.query.mockResolvedValueOnce({
        recordset: [{ IDCPROPERTYID: 'P1', IDCLISTOFFICEKEY: 200 }]
      })
      // Office query for expand
      db.query.mockResolvedValueOnce({
        recordset: [{ OFFICEKEY: 200, OFFICENAME: 'Main Office' }]
      })

      const res = await request(app)
        .get('/odata/Property?$expand=ListOffice')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.value[0].ListOffice).toBeDefined()
      expect(res.body.value[0].ListOffice.OfficeKey).toBe(200)
    })

    test('GET /odata/Property with invalid $expand returns error', async () => {
      const res = await request(app)
        .get('/odata/Property?$expand=InvalidExpand')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(500)
      expect(res.body.error.message).toContain('Invalid $expand')
    })
  })

  describe('Pagination with @odata.nextLink', () => {
    let token

    beforeAll(async () => {
      const tokenRes = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-secret'
        })
      token = tokenRes.body.access_token
    })

    test('Includes nextLink when more results available', async () => {
      db.query
        .mockResolvedValueOnce({ recordset: [{ IDCPROPERTYID: 'P1' }] })
        .mockResolvedValueOnce({ recordset: [{ total: 100 }] })

      const res = await request(app)
        .get('/odata/Property?$top=10&$skip=0&$count=true')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body['@odata.count']).toBe(100)
      expect(res.body['@odata.nextLink']).toBeDefined()
      // URL params are encoded (%24 = $)
      expect(res.body['@odata.nextLink']).toContain('%24skip=10')
    })

    test('Does not include nextLink on last page', async () => {
      db.query
        .mockResolvedValueOnce({ recordset: [{ IDCPROPERTYID: 'P1' }] })
        .mockResolvedValueOnce({ recordset: [{ total: 5 }] })

      const res = await request(app)
        .get('/odata/Property?$top=10&$skip=0&$count=true')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body['@odata.count']).toBe(5)
      expect(res.body['@odata.nextLink']).toBeUndefined()
    })
  })

  describe('Error Handling', () => {
    let token

    beforeAll(async () => {
      const tokenRes = await request(app)
        .post('/odata/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-secret'
        })
      token = tokenRes.body.access_token
    })

    test('Database error returns 500', async () => {
      db.query.mockRejectedValueOnce(new Error('Database connection failed'))

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(500)
      expect(res.body.error).toBeDefined()
    })
  })
})
