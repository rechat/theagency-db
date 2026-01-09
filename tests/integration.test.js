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
      expect(res.body.value[0].ListingKey).toBe('86065') // 'P1' encoded as BigInt
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
      expect(query).toContain('WHERE MLSBOARD = @mlsBoard AND CITY = @filter0')
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

      // Use encoded key: 'P123' encodes to '5640368691'
      const res = await request(app)
        .get("/odata/Property('5640368691')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.ListingKey).toBe('5640368691') // 'P123' encoded as BigInt
      expect(res.body['@odata.context']).toContain('$entity')
    })

    test('GET /odata/Property(key) returns 404 for invalid key', async () => {
      // Invalid (non-numeric) keys return 404
      const res = await request(app)
        .get("/odata/Property('NOTFOUND')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NotFound')
    })

    test('GET /odata/Property(key) returns 404 for missing property', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      // Use encoded key for a valid format but non-existent property
      const res = await request(app)
        .get("/odata/Property('86065')")  // encodes to 'P1' but not found
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

  describe('ListingKey Encoding Roundtrip', () => {
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

    test('ListingKey from filtered list query can be used to fetch single property', async () => {
      const originalId = 'MLS-12345-ABC'

      // First query: filter by status returns property with encoded ListingKey
      db.query.mockResolvedValueOnce({
        recordset: [{
          IDCPROPERTYID: originalId,
          IDCMLSNUMBER: 'MLS123',
          IDCSTATUS: 'Active',
          CITY: 'Los Angeles'
        }]
      })

      const listRes = await request(app)
        .get("/odata/Property?$filter=StandardStatus eq 'Active'")
        .set('Authorization', `Bearer ${token}`)

      expect(listRes.status).toBe(200)
      expect(listRes.body.value).toHaveLength(1)

      const returnedListingKey = listRes.body.value[0].ListingKey
      expect(returnedListingKey).toBeDefined()
      expect(typeof returnedListingKey).toBe('string')
      // Encoded key should be numeric string
      expect(/^\d+$/.test(returnedListingKey)).toBe(true)

      // Second query: use the returned ListingKey to fetch the same property
      db.query.mockResolvedValueOnce({
        recordset: [{
          IDCPROPERTYID: originalId,
          IDCMLSNUMBER: 'MLS123',
          IDCSTATUS: 'Active',
          CITY: 'Los Angeles'
        }]
      })

      const getRes = await request(app)
        .get(`/odata/Property('${returnedListingKey}')`)
        .set('Authorization', `Bearer ${token}`)

      expect(getRes.status).toBe(200)
      expect(getRes.body.ListingKey).toBe(returnedListingKey)
      expect(getRes.body.ListingId).toBe('MLS123')
      expect(getRes.body.City).toBe('Los Angeles')

      // Verify the database was queried with the ORIGINAL (decoded) ID
      const dbCallArgs = db.query.mock.calls[1]
      expect(dbCallArgs[1].keyValue).toBe(originalId)
    })

    test('ListingKey encoding handles various MLS number formats', async () => {
      const testCases = [
        'P1',                    // Short
        'MLS-2024-00001',        // With dashes
        'CRMLS_12345678',        // With underscore
        'AB123456789012345678',  // Long (20 chars)
      ]

      for (const originalId of testCases) {
        jest.clearAllMocks()

        // List query returns property
        db.query.mockResolvedValueOnce({
          recordset: [{ IDCPROPERTYID: originalId, CITY: 'Test City' }]
        })

        const listRes = await request(app)
          .get('/odata/Property?$top=1')
          .set('Authorization', `Bearer ${token}`)

        expect(listRes.status).toBe(200)
        const encodedKey = listRes.body.value[0].ListingKey

        // Single entity query with encoded key
        db.query.mockResolvedValueOnce({
          recordset: [{ IDCPROPERTYID: originalId, CITY: 'Test City' }]
        })

        const getRes = await request(app)
          .get(`/odata/Property('${encodedKey}')`)
          .set('Authorization', `Bearer ${token}`)

        expect(getRes.status).toBe(200)
        expect(getRes.body.ListingKey).toBe(encodedKey)

        // Verify decoded ID matches original
        const dbCallArgs = db.query.mock.calls[1]
        expect(dbCallArgs[1].keyValue).toBe(originalId)
      }
    })

    test('Multiple properties from list can each be fetched by their ListingKey', async () => {
      const properties = [
        { IDCPROPERTYID: 'PROP-001', CITY: 'Los Angeles', IDCLISTPRICE: 500000 },
        { IDCPROPERTYID: 'PROP-002', CITY: 'Beverly Hills', IDCLISTPRICE: 1000000 },
        { IDCPROPERTYID: 'PROP-003', CITY: 'Malibu', IDCLISTPRICE: 2000000 }
      ]

      // List query returns multiple properties
      db.query.mockResolvedValueOnce({ recordset: properties })

      const listRes = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(listRes.status).toBe(200)
      expect(listRes.body.value).toHaveLength(3)

      // Each returned ListingKey should be usable to fetch that specific property
      for (let i = 0; i < properties.length; i++) {
        const returnedProp = listRes.body.value[i]
        const originalProp = properties[i]

        db.query.mockResolvedValueOnce({ recordset: [originalProp] })

        const getRes = await request(app)
          .get(`/odata/Property('${returnedProp.ListingKey}')`)
          .set('Authorization', `Bearer ${token}`)

        expect(getRes.status).toBe(200)
        expect(getRes.body.ListingKey).toBe(returnedProp.ListingKey)
        expect(getRes.body.City).toBe(originalProp.CITY)
        expect(getRes.body.ListPrice).toBe(originalProp.IDCLISTPRICE)
      }
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
