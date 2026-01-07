/**
 * Unit Tests for OData Query Parser
 * Tests tokenization, parsing, and SQL generation
 */

const {
  parseFilter,
  parseSelect,
  parseOrderBy,
  parseExpand,
  buildQuery,
  transformRow,
  tokenizeFilter
} = require('../odata/parser')

// Sample field map for testing
const fieldMap = {
  ListingKey: 'IDCPROPERTYID',
  ListingId: 'IDCMLSNUMBER',
  ListPrice: 'IDCLISTPRICE',
  City: 'CITY',
  StateOrProvince: 'STATE',
  StandardStatus: 'IDCSTATUS',
  BedroomsTotal: 'BEDS',
  ModificationTimestamp: 'LASTMODIFIED'
}

describe('tokenizeFilter', () => {
  test('tokenizes simple equality', () => {
    const tokens = tokenizeFilter("City eq 'Los Angeles'")
    expect(tokens).toEqual([
      { type: 'identifier', value: 'City' },
      { type: 'operator', value: 'eq' },
      { type: 'string', value: 'Los Angeles' }
    ])
  })

  test('tokenizes numeric comparison', () => {
    const tokens = tokenizeFilter('ListPrice gt 500000')
    expect(tokens).toEqual([
      { type: 'identifier', value: 'ListPrice' },
      { type: 'operator', value: 'gt' },
      { type: 'number', value: 500000 }
    ])
  })

  test('tokenizes logical operators', () => {
    const tokens = tokenizeFilter("City eq 'LA' and ListPrice gt 100000")
    expect(tokens).toHaveLength(7)
    expect(tokens[3]).toEqual({ type: 'logical', value: 'and' })
  })

  test('tokenizes function calls', () => {
    const tokens = tokenizeFilter("contains(City, 'Angeles')")
    expect(tokens).toEqual([
      { type: 'function', value: 'contains' },
      { type: 'paren', value: '(' },
      { type: 'identifier', value: 'City' },
      { type: 'comma', value: ',' },
      { type: 'string', value: 'Angeles' },
      { type: 'paren', value: ')' }
    ])
  })

  test('tokenizes null and boolean literals', () => {
    const tokens = tokenizeFilter('City eq null')
    expect(tokens[2]).toEqual({ type: 'literal', value: 'null' })

    const boolTokens = tokenizeFilter('IsActive eq true')
    expect(boolTokens[2]).toEqual({ type: 'literal', value: 'true' })
  })

  test('handles escaped quotes in strings', () => {
    const tokens = tokenizeFilter("City eq 'O''Brien'")
    expect(tokens[2]).toEqual({ type: 'string', value: "O'Brien" })
  })

  test('handles parentheses for grouping', () => {
    const tokens = tokenizeFilter("(City eq 'LA' or City eq 'NYC')")
    expect(tokens[0]).toEqual({ type: 'paren', value: '(' })
    expect(tokens[tokens.length - 1]).toEqual({ type: 'paren', value: ')' })
  })

  test('throws on unexpected character', () => {
    expect(() => tokenizeFilter('City = "LA"')).toThrow('Unexpected character')
  })
})

describe('parseFilter', () => {
  test('parses simple equality', () => {
    const { sql, params } = parseFilter("City eq 'Los Angeles'", fieldMap)
    expect(sql).toBe('CITY = @filter0')
    expect(params.filter0).toBe('Los Angeles')
  })

  test('parses numeric comparison operators', () => {
    const gt = parseFilter('ListPrice gt 500000', fieldMap)
    expect(gt.sql).toBe('IDCLISTPRICE > @filter0')
    expect(gt.params.filter0).toBe(500000)

    const le = parseFilter('BedroomsTotal le 3', fieldMap)
    expect(le.sql).toBe('BEDS <= @filter0')
    expect(le.params.filter0).toBe(3)
  })

  test('parses compound filters with AND', () => {
    const { sql, params } = parseFilter("City eq 'LA' and ListPrice gt 100000", fieldMap)
    expect(sql).toBe('CITY = @filter0 AND IDCLISTPRICE > @filter1')
    expect(params.filter0).toBe('LA')
    expect(params.filter1).toBe(100000)
  })

  test('parses compound filters with OR', () => {
    const { sql, params } = parseFilter("City eq 'LA' or City eq 'NYC'", fieldMap)
    expect(sql).toBe('CITY = @filter0 OR CITY = @filter1')
    expect(params.filter0).toBe('LA')
    expect(params.filter1).toBe('NYC')
  })

  test('parses contains function', () => {
    const { sql, params } = parseFilter("contains(City, 'Angeles')", fieldMap)
    expect(sql).toBe('CITY LIKE @filter0')
    expect(params.filter0).toBe('%Angeles%')
  })

  test('parses startswith function', () => {
    const { sql, params } = parseFilter("startswith(City, 'Los')", fieldMap)
    expect(sql).toBe('CITY LIKE @filter0')
    expect(params.filter0).toBe('Los%')
  })

  test('parses endswith function', () => {
    const { sql, params } = parseFilter("endswith(City, 'Beach')", fieldMap)
    expect(sql).toBe('CITY LIKE @filter0')
    expect(params.filter0).toBe('%Beach')
  })

  test('parses null comparison', () => {
    const { sql } = parseFilter('City eq null', fieldMap)
    expect(sql).toBe('CITY = NULL')
  })

  test('parses boolean literals', () => {
    // Note: These would need an actual boolean field in fieldMap
    const trueResult = parseFilter('StandardStatus eq true', fieldMap)
    expect(trueResult.sql).toBe('IDCSTATUS = 1')

    const falseResult = parseFilter('StandardStatus eq false', fieldMap)
    expect(falseResult.sql).toBe('IDCSTATUS = 0')
  })

  test('returns empty for null/undefined input', () => {
    expect(parseFilter(null, fieldMap)).toEqual({ sql: '', params: {} })
    expect(parseFilter(undefined, fieldMap)).toEqual({ sql: '', params: {} })
  })

  test('throws on unknown field', () => {
    expect(() => parseFilter("InvalidField eq 'test'", fieldMap))
      .toThrow('Unknown field: InvalidField')
  })

  test('prevents SQL injection via field names', () => {
    expect(() => parseFilter("'; DROP TABLE users; -- eq 'test'", fieldMap))
      .toThrow()
  })

  test('safely handles SQL injection in values (via parameterization)', () => {
    // Values with quotes are safely parameterized
    const { sql, params } = parseFilter("City eq 'test'' OR 1=1'", fieldMap)
    // Value should be parameterized, not interpolated
    expect(sql).toBe('CITY = @filter0')
    expect(params.filter0).toBe("test' OR 1=1")
  })
})

describe('parseSelect', () => {
  test('returns all fields when select is empty', () => {
    const result = parseSelect(null, fieldMap)
    expect(result).toBe('IDCPROPERTYID, IDCMLSNUMBER, IDCLISTPRICE, CITY, STATE, IDCSTATUS, BEDS, LASTMODIFIED')
  })

  test('maps single field', () => {
    const result = parseSelect('ListingKey', fieldMap)
    expect(result).toBe('IDCPROPERTYID')
  })

  test('maps multiple fields', () => {
    const result = parseSelect('ListingKey,City,ListPrice', fieldMap)
    expect(result).toBe('IDCPROPERTYID, CITY, IDCLISTPRICE')
  })

  test('handles whitespace in field list', () => {
    const result = parseSelect('ListingKey, City, ListPrice', fieldMap)
    expect(result).toBe('IDCPROPERTYID, CITY, IDCLISTPRICE')
  })

  test('throws on invalid field', () => {
    expect(() => parseSelect('InvalidField', fieldMap))
      .toThrow('Invalid field in $select: InvalidField')
  })

  test('throws on SQL injection attempt', () => {
    expect(() => parseSelect('ListingKey; DROP TABLE users', fieldMap))
      .toThrow('Invalid field in $select')
  })
})

describe('parseOrderBy', () => {
  test('returns empty for null input', () => {
    expect(parseOrderBy(null, fieldMap)).toBe('')
  })

  test('parses single field ascending', () => {
    const result = parseOrderBy('ListPrice', fieldMap)
    expect(result).toBe('IDCLISTPRICE ASC')
  })

  test('parses single field with explicit asc', () => {
    const result = parseOrderBy('ListPrice asc', fieldMap)
    expect(result).toBe('IDCLISTPRICE ASC')
  })

  test('parses single field descending', () => {
    const result = parseOrderBy('ListPrice desc', fieldMap)
    expect(result).toBe('IDCLISTPRICE DESC')
  })

  test('parses multiple fields', () => {
    const result = parseOrderBy('City asc, ListPrice desc', fieldMap)
    expect(result).toBe('CITY ASC, IDCLISTPRICE DESC')
  })

  test('throws on invalid field', () => {
    expect(() => parseOrderBy('InvalidField asc', fieldMap))
      .toThrow('Invalid field in $orderby: InvalidField')
  })
})

describe('parseExpand', () => {
  const allowed = ['ListAgent', 'ListOffice']

  test('returns empty array for null input', () => {
    expect(parseExpand(null, allowed)).toEqual([])
  })

  test('parses single expansion', () => {
    expect(parseExpand('ListAgent', allowed)).toEqual(['ListAgent'])
  })

  test('parses multiple expansions', () => {
    expect(parseExpand('ListAgent,ListOffice', allowed)).toEqual(['ListAgent', 'ListOffice'])
  })

  test('handles whitespace', () => {
    expect(parseExpand('ListAgent, ListOffice', allowed)).toEqual(['ListAgent', 'ListOffice'])
  })

  test('throws on invalid expansion', () => {
    expect(() => parseExpand('InvalidExpand', allowed))
      .toThrow('Invalid $expand: InvalidExpand')
  })
})

describe('buildQuery', () => {
  const table = 'test_table'

  test('builds basic query with defaults', () => {
    const { dataQuery, params, top, skip } = buildQuery({
      table,
      fieldMap,
      query: {},
      keyField: 'ListingKey'
    })

    expect(dataQuery).toContain('SELECT')
    expect(dataQuery).toContain('FROM test_table')
    expect(dataQuery).toContain('OFFSET 0 ROWS')
    expect(dataQuery).toContain('FETCH NEXT 100 ROWS ONLY')
    expect(top).toBe(100)
    expect(skip).toBe(0)
  })

  test('applies $top limit', () => {
    const { dataQuery, top } = buildQuery({
      table,
      fieldMap,
      query: { $top: '50' },
      keyField: 'ListingKey'
    })

    expect(dataQuery).toContain('FETCH NEXT 50 ROWS ONLY')
    expect(top).toBe(50)
  })

  test('enforces maximum $top of 1000', () => {
    const { top } = buildQuery({
      table,
      fieldMap,
      query: { $top: '5000' },
      keyField: 'ListingKey'
    })

    expect(top).toBe(1000)
  })

  test('enforces minimum $top of 1', () => {
    const { top } = buildQuery({
      table,
      fieldMap,
      query: { $top: '-10' },
      keyField: 'ListingKey'
    })

    expect(top).toBe(1)
  })

  test('applies $skip offset', () => {
    const { dataQuery, skip } = buildQuery({
      table,
      fieldMap,
      query: { $skip: '100' },
      keyField: 'ListingKey'
    })

    expect(dataQuery).toContain('OFFSET 100 ROWS')
    expect(skip).toBe(100)
  })

  test('enforces minimum $skip of 0', () => {
    const { skip } = buildQuery({
      table,
      fieldMap,
      query: { $skip: '-50' },
      keyField: 'ListingKey'
    })

    expect(skip).toBe(0)
  })

  test('generates count query when $count=true', () => {
    const { countQuery } = buildQuery({
      table,
      fieldMap,
      query: { $count: 'true' },
      keyField: 'ListingKey'
    })

    expect(countQuery).toContain('SELECT COUNT(*) as total')
    expect(countQuery).toContain('FROM test_table')
  })

  test('does not generate count query when $count is not true', () => {
    const { countQuery } = buildQuery({
      table,
      fieldMap,
      query: { $count: 'false' },
      keyField: 'ListingKey'
    })

    expect(countQuery).toBeNull()
  })

  test('applies $filter to WHERE clause', () => {
    const { dataQuery, params } = buildQuery({
      table,
      fieldMap,
      query: { $filter: "City eq 'Los Angeles'" },
      keyField: 'ListingKey'
    })

    expect(dataQuery).toContain('WHERE CITY = @filter0')
    expect(params.filter0).toBe('Los Angeles')
  })

  test('applies $select to column list', () => {
    const { dataQuery } = buildQuery({
      table,
      fieldMap,
      query: { $select: 'ListingKey,City' },
      keyField: 'ListingKey'
    })

    expect(dataQuery).toContain('SELECT IDCPROPERTYID, CITY')
  })

  test('applies $orderby', () => {
    const { dataQuery } = buildQuery({
      table,
      fieldMap,
      query: { $orderby: 'ListPrice desc' },
      keyField: 'ListingKey'
    })

    expect(dataQuery).toContain('ORDER BY IDCLISTPRICE DESC')
  })

  test('uses default order when $orderby not specified', () => {
    const { dataQuery } = buildQuery({
      table,
      fieldMap,
      query: {},
      keyField: 'ListingKey'
    })

    // Should default to first field in fieldMap
    expect(dataQuery).toContain('ORDER BY')
  })

  test('handles single entity lookup with keyValue', () => {
    const { dataQuery, params } = buildQuery({
      table,
      fieldMap,
      query: {},
      keyField: 'ListingKey',
      keyValue: 'ABC123'
    })

    expect(dataQuery).toContain('WHERE IDCPROPERTYID = @keyValue')
    expect(params.keyValue).toBe('ABC123')
  })

  test('generates nextLinkBuilder when baseUrl provided', () => {
    const { nextLinkBuilder } = buildQuery({
      table,
      fieldMap,
      query: { $top: '10', $skip: '0', $count: 'true' },
      keyField: 'ListingKey',
      baseUrl: 'http://localhost/odata/Property'
    })

    expect(nextLinkBuilder).not.toBeNull()

    // Test nextLink generation
    const nextLink = nextLinkBuilder(100) // 100 total records
    // URL-encoded: %24 = $
    expect(nextLink).toContain('%24skip=10')
    expect(nextLink).toContain('%24top=10')
  })

  test('nextLinkBuilder returns null when no more results', () => {
    const { nextLinkBuilder } = buildQuery({
      table,
      fieldMap,
      query: { $top: '10', $skip: '0' },
      keyField: 'ListingKey',
      baseUrl: 'http://localhost/odata/Property'
    })

    // Only 5 total records, already showing all
    const nextLink = nextLinkBuilder(5)
    expect(nextLink).toBeNull()
  })
})

describe('transformRow', () => {
  const reverseFieldMap = {
    IDCPROPERTYID: 'ListingKey',
    CITY: 'City',
    IDCLISTPRICE: 'ListPrice'
  }

  test('transforms database row to RESO format', () => {
    const row = {
      IDCPROPERTYID: 'ABC123',
      CITY: 'Los Angeles',
      IDCLISTPRICE: 500000
    }

    const result = transformRow(row, reverseFieldMap)
    expect(result).toEqual({
      ListingKey: 'ABC123',
      City: 'Los Angeles',
      ListPrice: 500000
    })
  })

  test('ignores unmapped fields', () => {
    const row = {
      IDCPROPERTYID: 'ABC123',
      UNKNOWN_FIELD: 'ignored'
    }

    const result = transformRow(row, reverseFieldMap)
    expect(result).toEqual({
      ListingKey: 'ABC123'
    })
    expect(result.UNKNOWN_FIELD).toBeUndefined()
  })

  test('handles null values', () => {
    const row = {
      IDCPROPERTYID: 'ABC123',
      CITY: null
    }

    const result = transformRow(row, reverseFieldMap)
    expect(result.City).toBeNull()
  })

  test('handles empty row', () => {
    const result = transformRow({}, reverseFieldMap)
    expect(result).toEqual({})
  })
})

describe('SQL Injection Prevention', () => {
  test('field names are validated against whitelist', () => {
    const malicious = "ListingKey; DROP TABLE users; --"
    expect(() => parseFilter(`${malicious} eq 'test'`, fieldMap)).toThrow()
  })

  test('values are always parameterized (quotes)', () => {
    // Test with escaped quotes which are valid in OData
    const malicious = "test'' OR 1=1 --"
    const { sql, params } = parseFilter(`City eq '${malicious}'`, fieldMap)

    // SQL should only contain parameter placeholder
    expect(sql).toBe('CITY = @filter0')
    // Value should be safely stored in params (with single quote unescaped)
    expect(params.filter0).toBe("test' OR 1=1 --")
  })

  test('function arguments are parameterized', () => {
    // Test contains with potentially malicious string (but valid OData)
    const { sql, params } = parseFilter("contains(City, 'test'' OR 1=1')", fieldMap)

    expect(sql).toBe('CITY LIKE @filter0')
    expect(params.filter0).toBe("%test' OR 1=1%")
  })

  test('rejects invalid characters outside strings', () => {
    // Semicolons are not valid OData syntax outside strings
    expect(() => parseFilter("City eq 'test'; DROP TABLE", fieldMap)).toThrow()
  })

  test('$select validates each field', () => {
    expect(() => parseSelect("ListingKey, '; DROP TABLE users; --", fieldMap)).toThrow()
  })

  test('$orderby validates each field', () => {
    expect(() => parseOrderBy("ListingKey, '; DROP TABLE users; -- desc", fieldMap)).toThrow()
  })
})
