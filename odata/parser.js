/**
 * OData Query Parser
 * Parses OData query parameters and converts to SQL
 *
 * SECURITY: All user input is parameterized to prevent SQL injection
 */

// Validate field name against whitelist (prevents SQL injection via field names)
function validateFieldName(fieldName, allowedFields) {
  if (!allowedFields.has(fieldName)) {
    throw new Error(`Invalid field name: ${fieldName}`)
  }
  return fieldName
}

// Tokenize filter expression
function tokenizeFilter(filter) {
  const tokens = []
  let i = 0

  while (i < filter.length) {
    // Skip whitespace
    if (/\s/.test(filter[i])) {
      i++
      continue
    }

    // String literal
    if (filter[i] === "'") {
      let value = ''
      i++ // skip opening quote
      while (i < filter.length) {
        if (filter[i] === "'" && filter[i + 1] === "'") {
          // Escaped quote
          value += "'"
          i += 2
        } else if (filter[i] === "'") {
          // End of string
          break
        } else {
          value += filter[i]
          i++
        }
      }
      i++ // skip closing quote
      tokens.push({ type: 'string', value })
      continue
    }

    // Number or datetime literal
    if (/[\d.-]/.test(filter[i])) {
      let value = ''
      // Check if this looks like a datetime (starts with 4 digits for year)
      const remaining = filter.slice(i)
      const isDatetime = /^\d{4}-\d{2}-\d{2}/.test(remaining)

      if (isDatetime) {
        // Parse datetime literal: allow digits, hyphens, colons, T, Z, dots
        while (i < filter.length && /[\d.:\-TZ+]/.test(filter[i])) {
          value += filter[i]
          i++
        }
        tokens.push({ type: 'datetime', value })
      } else {
        // Regular number
        while (i < filter.length && /[\d.eE+-]/.test(filter[i])) {
          value += filter[i]
          i++
        }
        tokens.push({ type: 'number', value: parseFloat(value) })
      }
      continue
    }

    // Parentheses
    if (filter[i] === '(' || filter[i] === ')') {
      tokens.push({ type: 'paren', value: filter[i] })
      i++
      continue
    }

    // Comma
    if (filter[i] === ',') {
      tokens.push({ type: 'comma', value: ',' })
      i++
      continue
    }

    // Word (identifier, operator, or function)
    if (/[a-zA-Z_]/.test(filter[i])) {
      let word = ''
      while (i < filter.length && /[a-zA-Z0-9_]/.test(filter[i])) {
        word += filter[i]
        i++
      }

      const lowerWord = word.toLowerCase()
      if (['eq', 'ne', 'gt', 'ge', 'lt', 'le'].includes(lowerWord)) {
        tokens.push({ type: 'operator', value: lowerWord })
      } else if (['and', 'or', 'not'].includes(lowerWord)) {
        tokens.push({ type: 'logical', value: lowerWord })
      } else if (['contains', 'startswith', 'endswith'].includes(lowerWord)) {
        tokens.push({ type: 'function', value: lowerWord })
      } else if (['null', 'true', 'false'].includes(lowerWord)) {
        tokens.push({ type: 'literal', value: lowerWord })
      } else {
        tokens.push({ type: 'identifier', value: word })
      }
      continue
    }

    throw new Error(`Unexpected character in filter: ${filter[i]}`)
  }

  return tokens
}

// Parse tokenized filter to SQL with parameters
function parseFilterTokens(tokens, fieldMap) {
  const allowedFields = new Set(Object.keys(fieldMap))
  const params = {}
  let paramIndex = 0
  let sql = ''
  let i = 0

  function getNextParamName() {
    return `filter${paramIndex++}`
  }

  while (i < tokens.length) {
    const token = tokens[i]

    if (token.type === 'identifier') {
      // Validate and map field name
      const resoField = token.value
      if (!allowedFields.has(resoField)) {
        throw new Error(`Unknown field: ${resoField}`)
      }
      sql += fieldMap[resoField]
      i++
      continue
    }

    if (token.type === 'operator') {
      const opMap = {
        'eq': '=',
        'ne': '!=',
        'gt': '>',
        'ge': '>=',
        'lt': '<',
        'le': '<='
      }
      sql += ` ${opMap[token.value]} `
      i++
      continue
    }

    if (token.type === 'logical') {
      sql += ` ${token.value.toUpperCase()} `
      i++
      continue
    }

    if (token.type === 'string') {
      const paramName = getNextParamName()
      params[paramName] = token.value
      sql += `@${paramName}`
      i++
      continue
    }

    if (token.type === 'number') {
      const paramName = getNextParamName()
      params[paramName] = token.value
      sql += `@${paramName}`
      i++
      continue
    }

    if (token.type === 'datetime') {
      const paramName = getNextParamName()
      params[paramName] = token.value
      sql += `@${paramName}`
      i++
      continue
    }

    if (token.type === 'literal') {
      if (token.value === 'null') {
        sql += 'NULL'
      } else if (token.value === 'true') {
        sql += '1'
      } else if (token.value === 'false') {
        sql += '0'
      }
      i++
      continue
    }

    if (token.type === 'function') {
      // Parse function call: functionName(field, value)
      const funcName = token.value
      i++ // skip function name

      if (tokens[i]?.type !== 'paren' || tokens[i]?.value !== '(') {
        throw new Error(`Expected ( after ${funcName}`)
      }
      i++ // skip (

      if (tokens[i]?.type !== 'identifier') {
        throw new Error(`Expected field name in ${funcName}()`)
      }
      const fieldName = tokens[i].value
      if (!allowedFields.has(fieldName)) {
        throw new Error(`Unknown field: ${fieldName}`)
      }
      i++

      if (tokens[i]?.type !== 'comma') {
        throw new Error(`Expected comma in ${funcName}()`)
      }
      i++ // skip comma

      if (tokens[i]?.type !== 'string') {
        throw new Error(`Expected string value in ${funcName}()`)
      }
      const value = tokens[i].value
      i++

      if (tokens[i]?.type !== 'paren' || tokens[i]?.value !== ')') {
        throw new Error(`Expected ) after ${funcName}`)
      }
      i++ // skip )

      const paramName = getNextParamName()
      const dbField = fieldMap[fieldName]

      if (funcName === 'contains') {
        params[paramName] = `%${value}%`
        sql += `${dbField} LIKE @${paramName}`
      } else if (funcName === 'startswith') {
        params[paramName] = `${value}%`
        sql += `${dbField} LIKE @${paramName}`
      } else if (funcName === 'endswith') {
        params[paramName] = `%${value}`
        sql += `${dbField} LIKE @${paramName}`
      }
      continue
    }

    if (token.type === 'paren') {
      sql += token.value
      i++
      continue
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`)
  }

  return { sql, params }
}

// Parse $filter expression to SQL WHERE clause
function parseFilter(filter, fieldMap) {
  if (!filter) return { sql: '', params: {} }

  try {
    const tokens = tokenizeFilter(filter)
    return parseFilterTokens(tokens, fieldMap)
  } catch (err) {
    throw new Error(`Invalid $filter: ${err.message}`)
  }
}

// Parse $select to SQL column list (validated against whitelist)
function parseSelect(select, fieldMap) {
  if (!select) {
    // Return all fields
    return Object.values(fieldMap).join(', ')
  }

  const allowedFields = new Set(Object.keys(fieldMap))
  const fields = select.split(',').map(f => f.trim())
  const dbFields = []

  for (const field of fields) {
    if (!allowedFields.has(field)) {
      throw new Error(`Invalid field in $select: ${field}`)
    }
    dbFields.push(fieldMap[field])
  }

  return dbFields.length > 0 ? dbFields.join(', ') : Object.values(fieldMap).join(', ')
}

// Parse $orderby to SQL ORDER BY clause (validated against whitelist)
function parseOrderBy(orderby, fieldMap) {
  if (!orderby) return ''

  const allowedFields = new Set(Object.keys(fieldMap))
  const parts = orderby.split(',').map(part => {
    const [field, direction] = part.trim().split(/\s+/)

    if (!allowedFields.has(field)) {
      throw new Error(`Invalid field in $orderby: ${field}`)
    }

    const dbField = fieldMap[field]
    const dir = direction?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'
    return `${dbField} ${dir}`
  })

  return parts.join(', ')
}

// Parse $expand to list of expansions (validated against allowed expansions)
function parseExpand(expand, allowedExpansions) {
  if (!expand) return []

  const expansions = expand.split(',').map(e => e.trim())
  const allowed = new Set(allowedExpansions || [])

  for (const exp of expansions) {
    if (!allowed.has(exp)) {
      throw new Error(`Invalid $expand: ${exp}. Allowed: ${allowedExpansions.join(', ')}`)
    }
  }

  return expansions
}

// Build complete SQL query
function buildQuery(options) {
  const {
    table,
    fieldMap,
    query,
    keyField,
    keyValue,
    baseUrl,
    baseWhere // Optional: { sql: 'COLUMN = @param', params: { param: 'value' } }
  } = options

  const top = Math.min(Math.max(parseInt(query.$top) || 100, 1), 1000) // Limit between 1-1000
  const skip = Math.max(parseInt(query.$skip) || 0, 0)
  const count = query.$count === 'true'

  // Build SELECT clause (validated)
  const selectFields = parseSelect(query.$select, fieldMap)

  // Build WHERE clause (parameterized)
  let whereConditions = []
  let params = {}

  // Apply base filter (always applied)
  if (baseWhere?.sql) {
    whereConditions.push(baseWhere.sql)
    Object.assign(params, baseWhere.params || {})
  }

  if (keyValue) {
    // Single entity lookup - parameterized
    whereConditions.push(`${fieldMap[keyField]} = @keyValue`)
    params.keyValue = keyValue
  } else if (query.$filter) {
    const filter = parseFilter(query.$filter, fieldMap)
    if (filter.sql) {
      whereConditions.push(filter.sql)
      Object.assign(params, filter.params)
    }
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : ''

  // Build ORDER BY clause (validated)
  const orderBy = parseOrderBy(query.$orderby, fieldMap)
  const orderByClause = orderBy ? `ORDER BY ${orderBy}` : `ORDER BY ${Object.values(fieldMap)[0]}`

  // Build main query with pagination
  const dataQuery = `
    SELECT ${selectFields}
    FROM ${table}
    ${whereClause}
    ${orderByClause}
    OFFSET ${skip} ROWS
    FETCH NEXT ${top} ROWS ONLY
  `

  // Build count query if needed
  const countQuery = count ? `
    SELECT COUNT(*) as total
    FROM ${table}
    ${whereClause}
  ` : null

  // Build nextLink if there might be more results
  let nextLinkBuilder = null
  if (baseUrl) {
    nextLinkBuilder = (totalCount) => {
      if (skip + top < totalCount) {
        const nextSkip = skip + top
        const queryParams = new URLSearchParams()
        queryParams.set('$top', top.toString())
        queryParams.set('$skip', nextSkip.toString())
        if (query.$select) queryParams.set('$select', query.$select)
        if (query.$filter) queryParams.set('$filter', query.$filter)
        if (query.$orderby) queryParams.set('$orderby', query.$orderby)
        if (query.$count) queryParams.set('$count', query.$count)
        return `${baseUrl}?${queryParams.toString()}`
      }
      return null
    }
  }

  return {
    dataQuery,
    countQuery,
    params,
    top,
    skip,
    nextLinkBuilder
  }
}

// Transform DB row to RESO format
function transformRow(row, reverseFieldMap) {
  const result = {}
  for (const [dbField, value] of Object.entries(row)) {
    const resoField = reverseFieldMap[dbField]
    if (resoField) {
      result[resoField] = value
    }
  }
  return result
}

module.exports = {
  parseFilter,
  parseSelect,
  parseOrderBy,
  parseExpand,
  buildQuery,
  transformRow,
  tokenizeFilter
}
