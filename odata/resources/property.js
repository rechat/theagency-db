const crypto = require('crypto')
const db = require('../../db')
const { buildQuery, transformRow, parseExpand } = require('../parser')

// Hash ListingKey to a 63-bit integer (fits in signed BIGINT)
function encodeListingKey(str) {
  if (!str) return null
  const hash = crypto.createHash('sha256').update(str).digest()
  // Use first 8 bytes, mask to 63 bits to fit in signed BIGINT
  const num = hash.readBigUInt64BE(0) & 0x7FFFFFFFFFFFFFFFn
  return num.toString()
}

const TABLE = 'idc_agy.AGY_CMNCMN_VW'
const KEY_FIELD = 'ListingKey'
const ALLOWED_EXPANSIONS = ['ListAgent', 'ListOffice']

// RESO field name -> DB column name
const fieldMap = {
  ListingKey: 'IDCPROPERTYID',
  ListingId: 'IDCMLSNUMBER',
  OriginatingSystemName: 'MLSBOARD',
  ListPrice: 'IDCLISTPRICE',
  StandardStatus: 'IDCSTATUS',
  ListingContractDate: 'IDCLISTDATE',
  PropertyType: 'PROPERTYTYPE',
  YearBuilt: 'YEARBUILT',
  BedroomsTotal: 'BEDS',
  BathroomsTotalInteger: 'BATHSTOTAL',
  LivingArea: 'SQFT',
  LotSizeArea: 'LOTSIZE',
  LotSizeAcres: 'ACRES',
  UnparsedAddress: 'IDCADDRESS',
  StreetNumber: 'STREETNUMBER',
  StreetName: 'STREETNAME',
  City: 'CITY',
  StateOrProvince: 'STATE',
  PostalCode: 'ZIPCODE',
  CountyOrParish: 'COUNTY',
  Country: 'COUNTRY',
  Latitude: 'IDCLATITUDE',
  Longitude: 'IDCLONGITUDE',
  PublicRemarks: 'IDCREMARKS',
  ListAgentKey: 'IDCLISTAGENTKEY',
  ListOfficeKey: 'IDCLISTOFFICEKEY',
  ListingURL: 'LISTINGDETAILURL',
  ModificationTimestamp: 'LASTMODIFIED',
  PhotoCount: 'MLSPHOTOCOUNT',
  PhotosChangeTimestamp: 'PHOTOMODIFIEDDATE',
  _PhotosXML: 'PROPERTYPHOTOS'
}

// Reverse map for transforming results
const reverseFieldMap = Object.fromEntries(
  Object.entries(fieldMap).map(([k, v]) => [v, k])
)

// Parse XML photo URLs to array
function parsePhotosXML(xml) {
  if (!xml) return []
  const urls = []
  const regex = /<URL>([^<]+)<\/URL>/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    urls.push(match[1])
  }
  return urls
}

// Transform property row and handle photos
function transformPropertyRow(row) {
  const result = transformRow(row, reverseFieldMap)

  // Encode ListingKey as integer
  if (result.ListingKey) {
    result.ListingKey = encodeListingKey(result.ListingKey)
  }

  // Convert XML photos to Media array
  if (result._PhotosXML) {
    result.Media = parsePhotosXML(result._PhotosXML).map((url, i) => ({
      MediaKey: crypto.createHash('sha256').update(url).digest('hex').substring(0, 16),
      ResourceRecordKey: result.ListingKey,
      MediaURL: url,
      Order: i + 1
    }))
    delete result._PhotosXML
  } else {
    result.Media = []
  }

  return result
}

// Member field map for $expand
const memberFieldMap = {
  MemberKey: 'AGENTKEY',
  MemberMlsId: 'AGYAGENTID',
  MemberFirstName: 'GIVENNAME',
  MemberLastName: 'SURNAME',
  MemberEmail: 'EMAILADDRESS1',
  MemberMobilePhone: 'MOBILEPHONE',
  MemberOfficePhone: 'BUSINESSPHONE'
}

const memberReverseFieldMap = Object.fromEntries(
  Object.entries(memberFieldMap).map(([k, v]) => [v, k])
)

// Office field map for $expand
const officeFieldMap = {
  OfficeKey: 'OFFICEKEY',
  OfficeName: 'OFFICENAME',
  OfficeCity: 'CITY',
  OfficeStateOrProvince: 'STATE',
  OfficePhone: 'PHONE'
}

const officeReverseFieldMap = Object.fromEntries(
  Object.entries(officeFieldMap).map(([k, v]) => [v, k])
)

async function expandListAgent(properties) {
  if (properties.length === 0) return

  const agentKeys = [...new Set(properties.map(p => p.ListAgentKey).filter(Boolean))]
  if (agentKeys.length === 0) return

  const placeholders = agentKeys.map((_, i) => `@agent${i}`).join(', ')
  const params = {}
  agentKeys.forEach((key, i) => { params[`agent${i}`] = key })

  const result = await db.query(
    `SELECT ${Object.values(memberFieldMap).join(', ')}
     FROM idc_agy.AGY_AGENT
     WHERE AGENTKEY IN (${placeholders})`,
    params
  )

  const agentMap = new Map()
  result.recordset.forEach(row => {
    const agent = transformRow(row, memberReverseFieldMap)
    agentMap.set(agent.MemberKey, agent)
  })

  properties.forEach(p => {
    if (p.ListAgentKey && agentMap.has(p.ListAgentKey)) {
      p.ListAgent = agentMap.get(p.ListAgentKey)
    }
  })
}

async function expandListOffice(properties) {
  if (properties.length === 0) return

  const officeKeys = [...new Set(properties.map(p => p.ListOfficeKey).filter(Boolean))]
  if (officeKeys.length === 0) return

  const placeholders = officeKeys.map((_, i) => `@office${i}`).join(', ')
  const params = {}
  officeKeys.forEach((key, i) => { params[`office${i}`] = key })

  const result = await db.query(
    `SELECT ${Object.values(officeFieldMap).join(', ')}
     FROM idc_agy.AGY_OFFICE
     WHERE OFFICEKEY IN (${placeholders})`,
    params
  )

  const officeMap = new Map()
  result.recordset.forEach(row => {
    const office = transformRow(row, officeReverseFieldMap)
    officeMap.set(office.OfficeKey, office)
  })

  properties.forEach(p => {
    if (p.ListOfficeKey && officeMap.has(p.ListOfficeKey)) {
      p.ListOffice = officeMap.get(p.ListOfficeKey)
    }
  })
}

async function list(req, res, next) {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}/Property`

    // Parse $expand
    const expansions = parseExpand(req.query.$expand, ALLOWED_EXPANSIONS)

    const { dataQuery, countQuery, params, nextLinkBuilder } = buildQuery({
      table: TABLE,
      fieldMap,
      query: req.query,
      keyField: KEY_FIELD,
      baseUrl
    })

    // Execute queries
    const [dataResult, countResult] = await Promise.all([
      db.query(dataQuery, params),
      countQuery ? db.query(countQuery, params) : Promise.resolve(null)
    ])

    // Transform rows to RESO format
    const value = dataResult.recordset.map(row => transformPropertyRow(row))

    // Handle $expand
    if (expansions.includes('ListAgent')) {
      await expandListAgent(value)
    }
    if (expansions.includes('ListOffice')) {
      await expandListOffice(value)
    }

    // Build response
    const response = {
      '@odata.context': `${req.protocol}://${req.get('host')}${req.baseUrl}/$metadata#Property`
    }

    if (countResult) {
      const totalCount = countResult.recordset[0].total
      response['@odata.count'] = totalCount

      // Add nextLink if there are more results
      if (nextLinkBuilder) {
        const nextLink = nextLinkBuilder(totalCount)
        if (nextLink) {
          response['@odata.nextLink'] = nextLink
        }
      }
    }

    response.value = value

    res.json(response)
  } catch (err) {
    next(err)
  }
}

async function get(req, res, next) {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`

    // Extract key from route param (format: 'key' or key)
    // Note: ListingKey is hashed for output, but lookups use original IDCPROPERTYID
    let key = req.params.key
    if (key.startsWith("'") && key.endsWith("'")) {
      key = key.slice(1, -1)
    }

    // Parse $expand
    const expansions = parseExpand(req.query.$expand, ALLOWED_EXPANSIONS)

    const { dataQuery, params } = buildQuery({
      table: TABLE,
      fieldMap,
      query: req.query,
      keyField: KEY_FIELD,
      keyValue: key
    })

    const result = await db.query(dataQuery, params)

    if (result.recordset.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NotFound',
          message: `Property with key '${key}' not found`
        }
      })
    }

    const entity = transformPropertyRow(result.recordset[0])

    // Handle $expand
    if (expansions.includes('ListAgent')) {
      await expandListAgent([entity])
    }
    if (expansions.includes('ListOffice')) {
      await expandListOffice([entity])
    }

    entity['@odata.context'] = `${baseUrl}/$metadata#Property/$entity`

    res.json(entity)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  list,
  get,
  fieldMap,
  reverseFieldMap,
  TABLE,
  KEY_FIELD,
  ALLOWED_EXPANSIONS
}
