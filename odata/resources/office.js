const db = require('../../db')
const { buildQuery, transformRow } = require('../parser')

const TABLE = 'idc_agy.AGY_OFFICE'
const KEY_FIELD = 'OfficeKey'

// RESO field name -> DB column name
const fieldMap = {
  OfficeKey: 'OFFICEKEY',
  OfficeName: 'OFFICENAME',
  OfficeAddress1: 'STREET',
  OfficeCity: 'CITY',
  OfficeStateOrProvince: 'STATE',
  OfficePostalCode: 'ZIPCODE',
  OfficeCountry: 'COUNTRY',
  OfficePhone: 'PHONE',
  OfficeFax: 'FAX',
  OfficeEmail: 'EMAILADDRESS1',
  OfficeLatitude: 'IDCLATITUDE',
  OfficeLongitude: 'IDCLONGITUDE',
  ModificationTimestamp: 'LASTMODIFIED'
}

// Reverse map for transforming results
const reverseFieldMap = Object.fromEntries(
  Object.entries(fieldMap).map(([k, v]) => [v, k])
)

async function list(req, res, next) {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`

    const { dataQuery, countQuery, params } = buildQuery({
      table: TABLE,
      fieldMap,
      query: req.query,
      keyField: KEY_FIELD
    })

    // Execute queries
    const [dataResult, countResult] = await Promise.all([
      db.query(dataQuery, params),
      countQuery ? db.query(countQuery, params) : Promise.resolve(null)
    ])

    // Transform rows to RESO format
    const value = dataResult.recordset.map(row => transformRow(row, reverseFieldMap))

    // Build response
    const response = {
      '@odata.context': `${baseUrl}/$metadata#Office`
    }

    if (countResult) {
      response['@odata.count'] = countResult.recordset[0].total
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

    // Extract key from route param
    let key = req.params.key
    if (key.startsWith("'") && key.endsWith("'")) {
      key = key.slice(1, -1)
    }
    key = parseInt(key) || key

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
          message: `Office with key '${key}' not found`
        }
      })
    }

    const entity = transformRow(result.recordset[0], reverseFieldMap)
    entity['@odata.context'] = `${baseUrl}/$metadata#Office/$entity`

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
  KEY_FIELD
}
