# The Agency URL Slugs & RESO Web API

## Project Overview

Two services for The Agency real estate:
1. **URL Redirect Service** - Redirects MLS numbers to theagencyre.com listing URLs
2. **RESO Web API** - OData v4 API exposing Property, Member, and Office resources

## Architecture

- **MSSQL** via SSH tunnel (ssh2 + mssql packages)
- **PostgreSQL** required for OAuth token storage (no in-memory fallback)
- PostgreSQL uses AWS RDS with `ssl: { rejectUnauthorized: false }`

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | Main Express server, URL redirect endpoint |
| `db.js` | SSH tunnel + MSSQL connection with auto-reconnect |
| `query.js` | CLI tool for ad-hoc SQL queries |
| `odata/index.js` | OData router |
| `odata/parser.js` | OData query parser - **SQL injection protected via tokenizer + whitelist** |
| `odata/auth.js` | OAuth2 client_credentials + refresh_token |
| `odata/tokenStore.js` | PostgreSQL token persistence |
| `odata/resources/*.js` | Property, Member, Office resources with field mappings |

## Environment Variables

Required in `.env`:
- SSH tunnel: `SSH_HOST`, `SSH_PORT`, `SSH_USERNAME`, `SSH_PASSWORD`
- MSSQL: `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_USERNAME`, `MSSQL_PASSWORD`, `MSSQL_DATABASE`
- PostgreSQL: `PG_CONNECTION_STRING`
- OAuth: `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`
- Optional: `BASE_URL`, `PORT`

## Commands

```bash
npm start              # Start server
npm run dev            # Dev mode with nodemon
npm test               # Run all 141 tests
npm run test:unit      # Parser unit tests
npm run test:integration  # Endpoint tests
npm run test:reso      # RESO certification tests
npm run query "SQL"    # Run ad-hoc SQL query
```

## URL Redirect

- `GET /listing/:mlsnumber` - Redirects to listing URL
- `GET /listing/:mlsnumber?mls=CRMLS` - Prioritize specific MLS board (MLS numbers aren't unique across boards)

## Security

- **SQL Injection Protection**: `odata/parser.js` uses tokenization + field whitelist. All values parameterized.
- **OAuth2**: 1-hour access tokens, 30-day refresh tokens, stored in PostgreSQL

## Testing

Tests mock database and token store. Token store mock maintains state in Maps for test isolation.
