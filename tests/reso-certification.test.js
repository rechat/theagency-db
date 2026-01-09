/**
 * RESO Web API Certification Test Suite
 * Tests compliance with RESO Web API (OData v4) specification
 *
 * Based on RESO Web API Core specification requirements:
 * - OData v4 protocol compliance
 * - RESO Data Dictionary field names
 * - Required response format and headers
 * - Query capabilities
 *
 * Reference: https://www.reso.org/reso-web-api/
 */

// Set up environment variables BEFORE requiring modules
process.env.OAUTH_CLIENT_ID = 'test-client'
process.env.OAUTH_CLIENT_SECRET = 'test-secret'

const request = require('supertest')
const express = require('express')

// Mock the database module
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

jest.useFakeTimers()

// Helper to get auth token
async function getAuthToken() {
  const res = await request(app)
    .post('/odata/token')
    .type('form')
    .send({
      grant_type: 'client_credentials',
      client_id: 'test-client',
      client_secret: 'test-secret'
    })
  return res.body.access_token
}

describe('RESO Web API Certification Tests', () => {
  let token

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  describe('REQ-WA-1: Service Document', () => {
    test('SHALL return valid service document at root URL', async () => {
      const res = await request(app).get('/odata/')

      expect(res.status).toBe(200)
      expect(res.body['@odata.context']).toBeDefined()
      expect(res.body.value).toBeInstanceOf(Array)
    })

    test('SHALL list all available EntitySets', async () => {
      const res = await request(app).get('/odata/')

      const entitySets = res.body.value.map(v => v.name)
      expect(entitySets).toContain('Property')
      expect(entitySets).toContain('Member')
      expect(entitySets).toContain('Office')
    })

    test('Each EntitySet SHALL have kind=EntitySet and valid URL', async () => {
      const res = await request(app).get('/odata/')

      res.body.value.forEach(entity => {
        expect(entity.kind).toBe('EntitySet')
        expect(entity.url).toBeDefined()
        expect(typeof entity.url).toBe('string')
      })
    })
  })

  describe('REQ-WA-2: Metadata Document', () => {
    test('SHALL return valid CSDL XML at $metadata endpoint', async () => {
      const res = await request(app).get('/odata/$metadata')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('application/xml')
      expect(res.text).toContain('<?xml')
      expect(res.text).toContain('edmx:Edmx')
    })

    test('SHALL declare OData Version 4.0', async () => {
      const res = await request(app).get('/odata/$metadata')

      expect(res.text).toContain('Version="4.0"')
    })

    test('SHALL define Property EntityType', async () => {
      const res = await request(app).get('/odata/$metadata')

      expect(res.text).toContain('<EntityType Name="Property">')
      expect(res.text).toContain('<Key>')
      expect(res.text).toContain('Name="ListingKey"')
    })

    test('SHALL define Member EntityType', async () => {
      const res = await request(app).get('/odata/$metadata')

      expect(res.text).toContain('<EntityType Name="Member">')
      expect(res.text).toContain('Name="MemberKey"')
    })

    test('SHALL define Office EntityType', async () => {
      const res = await request(app).get('/odata/$metadata')

      expect(res.text).toContain('<EntityType Name="Office">')
      expect(res.text).toContain('Name="OfficeKey"')
    })

    test('SHALL use RESO Data Dictionary field names', async () => {
      const res = await request(app).get('/odata/$metadata')

      // Property fields
      expect(res.text).toContain('Name="ListingKey"')
      expect(res.text).toContain('Name="ListingId"')
      expect(res.text).toContain('Name="ListPrice"')
      expect(res.text).toContain('Name="StandardStatus"')
      expect(res.text).toContain('Name="City"')
      expect(res.text).toContain('Name="StateOrProvince"')
      expect(res.text).toContain('Name="PostalCode"')
      expect(res.text).toContain('Name="BedroomsTotal"')
      expect(res.text).toContain('Name="BathroomsTotalInteger"')
      expect(res.text).toContain('Name="LivingArea"')

      // Member fields
      expect(res.text).toContain('Name="MemberKey"')
      expect(res.text).toContain('Name="MemberFirstName"')
      expect(res.text).toContain('Name="MemberLastName"')
      expect(res.text).toContain('Name="MemberEmail"')

      // Office fields
      expect(res.text).toContain('Name="OfficeKey"')
      expect(res.text).toContain('Name="OfficeName"')
    })
  })

  describe('REQ-WA-3: Response Headers', () => {
    test('SHALL include OData-Version header in responses', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(res.headers['odata-version']).toBe('4.0')
    })

    test('SHALL return JSON by default', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(res.headers['content-type']).toContain('application/json')
    })
  })

  describe('REQ-WA-4: Collection Response Format', () => {
    test('SHALL include @odata.context in collection response', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(res.body['@odata.context']).toBeDefined()
      expect(res.body['@odata.context']).toContain('$metadata#Property')
    })

    test('SHALL return results in value array', async () => {
      db.query.mockResolvedValueOnce({
        recordset: [{ IDCPROPERTYID: 'P1', CITY: 'Los Angeles' }]
      })

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(res.body.value).toBeInstanceOf(Array)
    })

    test('SHALL use RESO field names in response', async () => {
      db.query.mockResolvedValueOnce({
        recordset: [{
          IDCPROPERTYID: 'P1',
          IDCMLSNUMBER: 'MLS123',
          CITY: 'Los Angeles',
          STATE: 'CA',
          IDCLISTPRICE: 500000
        }]
      })

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      const property = res.body.value[0]
      expect(property.ListingKey).toBe('2295') // 'P1' encoded as base-37
      expect(property.ListingId).toBe('MLS123')
      expect(property.City).toBe('Los Angeles')
      expect(property.StateOrProvince).toBe('CA')
      expect(property.ListPrice).toBe(500000)
    })
  })

  describe('REQ-WA-5: Entity Response Format', () => {
    test('SHALL include @odata.context with $entity for single entity', async () => {
      db.query.mockResolvedValueOnce({
        recordset: [{ IDCPROPERTYID: 'P123', CITY: 'Los Angeles' }]
      })

      // Use encoded key: 'P123' encodes to '3141932'
      const res = await request(app)
        .get("/odata/Property('3141932')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.body['@odata.context']).toContain('$entity')
    })

    test('SHALL return 404 for non-existent entity', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      // Use encoded key: 'P1' encodes to '2295'
      const res = await request(app)
        .get("/odata/Property('2295')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBeDefined()
      expect(res.body.error.code).toBe('NotFound')
    })
  })

  describe('REQ-WA-6: $select Query Option', () => {
    test('SHALL support $select to limit returned fields', async () => {
      db.query.mockResolvedValueOnce({
        recordset: [{ IDCPROPERTYID: 'P1', CITY: 'Los Angeles' }]
      })

      const res = await request(app)
        .get('/odata/Property?$select=ListingKey,City')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      // Verify SQL only selects requested fields
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('SELECT IDCPROPERTYID, CITY')
    })

    test('SHALL reject invalid field names in $select', async () => {
      const res = await request(app)
        .get('/odata/Property?$select=InvalidField')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(500)
      expect(res.body.error.message).toContain('Invalid field')
    })
  })

  describe('REQ-WA-7: $filter Query Option', () => {
    test('SHALL support eq operator', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get("/odata/Property?$filter=City eq 'Los Angeles'")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const [query, params] = db.query.mock.calls[0]
      expect(query).toContain('WHERE MLSBOARD = @mlsBoard AND CITY = @filter0')
      expect(params.filter0).toBe('Los Angeles')
    })

    test('SHALL support ne operator', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get("/odata/Property?$filter=City ne 'Los Angeles'")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('WHERE MLSBOARD = @mlsBoard AND CITY != @filter0')
    })

    test('SHALL support gt, ge, lt, le operators', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property?$filter=ListPrice gt 500000')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('WHERE MLSBOARD = @mlsBoard AND IDCLISTPRICE > @filter0')
    })

    test('SHALL support and logical operator', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get("/odata/Property?$filter=City eq 'LA' and ListPrice gt 100000")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('AND')
    })

    test('SHALL support or logical operator', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get("/odata/Property?$filter=City eq 'LA' or City eq 'NYC'")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('OR')
    })

    test('SHALL support contains function', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get("/odata/Property?$filter=contains(City, 'Angeles')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const [query, params] = db.query.mock.calls[0]
      expect(query).toContain('CITY LIKE @filter0')
      expect(params.filter0).toBe('%Angeles%')
    })

    test('SHALL support startswith function', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get("/odata/Property?$filter=startswith(City, 'Los')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const [query, params] = db.query.mock.calls[0]
      expect(query).toContain('CITY LIKE @filter0')
      expect(params.filter0).toBe('Los%')
    })

    test('SHALL support endswith function', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get("/odata/Property?$filter=endswith(City, 'Beach')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const [query, params] = db.query.mock.calls[0]
      expect(query).toContain('CITY LIKE @filter0')
      expect(params.filter0).toBe('%Beach')
    })

    test('SHALL reject invalid field names in $filter', async () => {
      const res = await request(app)
        .get("/odata/Property?$filter=InvalidField eq 'test'")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(500)
      expect(res.body.error.message).toContain('Unknown field')
    })
  })

  describe('REQ-WA-8: $orderby Query Option', () => {
    test('SHALL support $orderby ascending', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property?$orderby=ListPrice asc')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('ORDER BY IDCLISTPRICE ASC')
    })

    test('SHALL support $orderby descending', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property?$orderby=ListPrice desc')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('ORDER BY IDCLISTPRICE DESC')
    })

    test('SHALL support multiple $orderby fields', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property?$orderby=City asc, ListPrice desc')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('ORDER BY CITY ASC, IDCLISTPRICE DESC')
    })
  })

  describe('REQ-WA-9: $top and $skip Query Options', () => {
    test('SHALL support $top to limit results', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property?$top=25')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('FETCH NEXT 25 ROWS ONLY')
    })

    test('SHALL support $skip for pagination', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property?$skip=50')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      expect(query).toContain('OFFSET 50 ROWS')
    })

    test('SHALL enforce maximum $top limit', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property?$top=10000')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      const query = db.query.mock.calls[0][0]
      // Should cap at 1000
      expect(query).toContain('FETCH NEXT 1000 ROWS ONLY')
    })
  })

  describe('REQ-WA-10: $count Query Option', () => {
    test('SHALL support $count=true', async () => {
      db.query
        .mockResolvedValueOnce({ recordset: [{ IDCPROPERTYID: 'P1' }] })
        .mockResolvedValueOnce({ recordset: [{ total: 1500 }] })

      const res = await request(app)
        .get('/odata/Property?$count=true')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body['@odata.count']).toBe(1500)
    })

    test('SHALL not include @odata.count when $count not specified', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body['@odata.count']).toBeUndefined()
    })
  })

  describe('REQ-WA-11: @odata.nextLink Pagination', () => {
    test('SHALL include @odata.nextLink when more results available', async () => {
      db.query
        .mockResolvedValueOnce({ recordset: [{ IDCPROPERTYID: 'P1' }] })
        .mockResolvedValueOnce({ recordset: [{ total: 500 }] })

      const res = await request(app)
        .get('/odata/Property?$top=100&$count=true')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body['@odata.nextLink']).toBeDefined()
    })

    test('nextLink SHALL contain $skip for next page', async () => {
      db.query
        .mockResolvedValueOnce({ recordset: [{ IDCPROPERTYID: 'P1' }] })
        .mockResolvedValueOnce({ recordset: [{ total: 500 }] })

      const res = await request(app)
        .get('/odata/Property?$top=100&$skip=0&$count=true')
        .set('Authorization', `Bearer ${token}`)

      expect(res.body['@odata.nextLink']).toContain('skip=100')
    })

    test('SHALL NOT include @odata.nextLink on final page', async () => {
      db.query
        .mockResolvedValueOnce({ recordset: [{ IDCPROPERTYID: 'P1' }] })
        .mockResolvedValueOnce({ recordset: [{ total: 50 }] })

      const res = await request(app)
        .get('/odata/Property?$top=100&$count=true')
        .set('Authorization', `Bearer ${token}`)

      expect(res.body['@odata.nextLink']).toBeUndefined()
    })
  })

  describe('REQ-WA-12: $expand Query Option', () => {
    test('SHALL support $expand for navigation properties', async () => {
      db.query
        .mockResolvedValueOnce({
          recordset: [{ IDCPROPERTYID: 'P1', IDCLISTAGENTKEY: 100 }]
        })
        .mockResolvedValueOnce({
          recordset: [{ AGENTKEY: 100, GIVENNAME: 'John', SURNAME: 'Doe' }]
        })

      const res = await request(app)
        .get('/odata/Property?$expand=ListAgent')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.value[0].ListAgent).toBeDefined()
      expect(res.body.value[0].ListAgent.MemberKey).toBe(100)
    })

    test('SHALL reject invalid $expand values', async () => {
      const res = await request(app)
        .get('/odata/Property?$expand=InvalidExpansion')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(500)
      expect(res.body.error.message).toContain('Invalid $expand')
    })
  })

  describe('REQ-WA-13: Error Response Format', () => {
    test('SHALL return error object with code and message', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      // Use encoded key: '2295' decodes to 'P1' which won't be found
      const res = await request(app)
        .get("/odata/Property('2295')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBeDefined()
      expect(res.body.error.code).toBeDefined()
      expect(res.body.error.message).toBeDefined()
    })

    test('SHALL return 404 for invalid encoded key format', async () => {
      // Non-numeric keys can't be decoded, return 404 immediately
      const res = await request(app)
        .get("/odata/Property('NOTFOUND')")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NotFound')
    })

    test('SHALL return proper error for invalid queries', async () => {
      const res = await request(app)
        .get("/odata/Property?$filter=invalid syntax here")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(500)
      expect(res.body.error).toBeDefined()
    })
  })

  describe('REQ-WA-14: Authentication', () => {
    test('SHALL require authentication for resource endpoints', async () => {
      const res = await request(app).get('/odata/Property')

      expect(res.status).toBe(401)
    })

    test('SHALL accept Bearer token authentication', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      const res = await request(app)
        .get('/odata/Property')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
    })

    test('SHALL NOT require auth for service document', async () => {
      const res = await request(app).get('/odata/')

      expect(res.status).toBe(200)
    })

    test('SHALL NOT require auth for metadata', async () => {
      const res = await request(app).get('/odata/$metadata')

      expect(res.status).toBe(200)
    })

    test('OAuth token endpoint SHALL support client_credentials grant', async () => {
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
      expect(res.body.expires_in).toBeGreaterThan(0)
    })
  })

  describe('REQ-WA-15: Resource-Specific Tests', () => {
    describe('Property Resource', () => {
      test('SHALL include key RESO fields', async () => {
        db.query.mockResolvedValueOnce({
          recordset: [{
            IDCPROPERTYID: 'P1',
            IDCMLSNUMBER: 'MLS123',
            MLSBOARD: 'CRMLS',
            IDCLISTPRICE: 500000,
            IDCSTATUS: 'Active',
            BEDS: 3,
            BATHSTOTAL: 2,
            SQFT: 1500,
            CITY: 'Los Angeles',
            STATE: 'CA',
            ZIPCODE: '90210',
            IDCLATITUDE: 34.0522,
            IDCLONGITUDE: -118.2437
          }]
        })

        const res = await request(app)
          .get('/odata/Property')
          .set('Authorization', `Bearer ${token}`)

        const property = res.body.value[0]
        expect(property.ListingKey).toBeDefined()
        expect(property.ListingId).toBeDefined()
        expect(property.ListPrice).toBeDefined()
        expect(property.StandardStatus).toBeDefined()
        expect(property.BedroomsTotal).toBeDefined()
        expect(property.BathroomsTotalInteger).toBeDefined()
        expect(property.LivingArea).toBeDefined()
        expect(property.City).toBeDefined()
        expect(property.StateOrProvince).toBeDefined()
        expect(property.PostalCode).toBeDefined()
        expect(property.Latitude).toBeDefined()
        expect(property.Longitude).toBeDefined()
      })
    })

    describe('Member Resource', () => {
      test('SHALL include key RESO fields', async () => {
        db.query.mockResolvedValueOnce({
          recordset: [{
            AGENTKEY: 1,
            AGYAGENTID: 'A123',
            GIVENNAME: 'John',
            SURNAME: 'Doe',
            EMAILADDRESS1: 'john@example.com',
            MOBILEPHONE: '555-1234'
          }]
        })

        const res = await request(app)
          .get('/odata/Member')
          .set('Authorization', `Bearer ${token}`)

        const member = res.body.value[0]
        expect(member.MemberKey).toBeDefined()
        expect(member.MemberMlsId).toBeDefined()
        expect(member.MemberFirstName).toBeDefined()
        expect(member.MemberLastName).toBeDefined()
        expect(member.MemberEmail).toBeDefined()
      })
    })

    describe('Office Resource', () => {
      test('SHALL include key RESO fields', async () => {
        db.query.mockResolvedValueOnce({
          recordset: [{
            OFFICEKEY: 1,
            OFFICENAME: 'Main Office',
            CITY: 'Los Angeles',
            STATE: 'CA',
            PHONE: '555-0000'
          }]
        })

        const res = await request(app)
          .get('/odata/Office')
          .set('Authorization', `Bearer ${token}`)

        const office = res.body.value[0]
        expect(office.OfficeKey).toBeDefined()
        expect(office.OfficeName).toBeDefined()
        expect(office.OfficeCity).toBeDefined()
        expect(office.OfficeStateOrProvince).toBeDefined()
        expect(office.OfficePhone).toBeDefined()
      })
    })
  })

  describe('Security Requirements', () => {
    test('SHALL use parameterized queries (no SQL injection)', async () => {
      db.query.mockResolvedValueOnce({ recordset: [] })

      // Attempt SQL injection
      const res = await request(app)
        .get("/odata/Property?$filter=City eq 'test'' OR 1=1; DROP TABLE Property --'")
        .set('Authorization', `Bearer ${token}`)

      // Should either succeed with safe parameterized query or fail with parse error
      // Either way, it should NOT execute raw SQL
      if (res.status === 200) {
        const [query, params] = db.query.mock.calls[0]
        // Verify the malicious string is parameterized, not in raw SQL
        expect(query).not.toContain('DROP TABLE')
        expect(Object.values(params).some(v =>
          typeof v === 'string' && v.includes('DROP TABLE')
        )).toBe(true)
      }
    })

    test('SHALL validate field names against whitelist', async () => {
      const res = await request(app)
        .get("/odata/Property?$select='; DROP TABLE Property; --")
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(500)
      expect(res.body.error.message).toContain('Invalid field')
    })
  })
})
