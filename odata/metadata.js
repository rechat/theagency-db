const NAMESPACE = 'org.reso.metadata'

const propertyFields = [
  { name: 'ListingKey', type: 'Edm.String', nullable: false },
  { name: 'ListingId', type: 'Edm.String' },
  { name: 'OriginatingSystemName', type: 'Edm.String' },
  { name: 'ListPrice', type: 'Edm.Decimal' },
  { name: 'StandardStatus', type: 'Edm.String' },
  { name: 'ListingContractDate', type: 'Edm.Date' },
  { name: 'PropertyType', type: 'Edm.String' },
  { name: 'YearBuilt', type: 'Edm.Int32' },
  { name: 'BedroomsTotal', type: 'Edm.Int32' },
  { name: 'BathroomsTotalInteger', type: 'Edm.Decimal' },
  { name: 'LivingArea', type: 'Edm.Decimal' },
  { name: 'LotSizeArea', type: 'Edm.String' },
  { name: 'LotSizeAcres', type: 'Edm.Decimal' },
  { name: 'UnparsedAddress', type: 'Edm.String' },
  { name: 'StreetNumber', type: 'Edm.String' },
  { name: 'StreetName', type: 'Edm.String' },
  { name: 'City', type: 'Edm.String' },
  { name: 'StateOrProvince', type: 'Edm.String' },
  { name: 'PostalCode', type: 'Edm.String' },
  { name: 'CountyOrParish', type: 'Edm.String' },
  { name: 'Country', type: 'Edm.String' },
  { name: 'Latitude', type: 'Edm.Decimal' },
  { name: 'Longitude', type: 'Edm.Decimal' },
  { name: 'PublicRemarks', type: 'Edm.String' },
  { name: 'ListAgentKey', type: 'Edm.Int32' },
  { name: 'ListOfficeKey', type: 'Edm.Int32' },
  { name: 'ListingURL', type: 'Edm.String' },
  { name: 'ModificationTimestamp', type: 'Edm.DateTimeOffset' },
  { name: 'PhotoCount', type: 'Edm.Int32' },
  { name: 'PhotosChangeTimestamp', type: 'Edm.DateTimeOffset' },
  { name: 'Media', type: 'Collection(org.reso.metadata.Media)' }
]

const mediaFields = [
  { name: 'MediaKey', type: 'Edm.String' },
  { name: 'MediaURL', type: 'Edm.String' },
  { name: 'Order', type: 'Edm.Int32' }
]

const memberFields = [
  { name: 'MemberKey', type: 'Edm.Int32', nullable: false },
  { name: 'MemberMlsId', type: 'Edm.String' },
  { name: 'MemberFirstName', type: 'Edm.String' },
  { name: 'MemberMiddleName', type: 'Edm.String' },
  { name: 'MemberLastName', type: 'Edm.String' },
  { name: 'MemberEmail', type: 'Edm.String' },
  { name: 'MemberMobilePhone', type: 'Edm.String' },
  { name: 'MemberOfficePhone', type: 'Edm.String' },
  { name: 'MemberAddress1', type: 'Edm.String' },
  { name: 'MemberCity', type: 'Edm.String' },
  { name: 'MemberStateOrProvince', type: 'Edm.String' },
  { name: 'MemberPostalCode', type: 'Edm.String' },
  { name: 'MemberStateLicense', type: 'Edm.String' },
  { name: 'MemberTitle', type: 'Edm.String' },
  { name: 'MemberComments', type: 'Edm.String' },
  { name: 'MemberPhotoURL', type: 'Edm.String' },
  { name: 'MemberWebsiteURL', type: 'Edm.String' },
  { name: 'OfficeKey', type: 'Edm.Int32' },
  { name: 'ModificationTimestamp', type: 'Edm.DateTimeOffset' }
]

const officeFields = [
  { name: 'OfficeKey', type: 'Edm.Int32', nullable: false },
  { name: 'OfficeName', type: 'Edm.String' },
  { name: 'OfficeAddress1', type: 'Edm.String' },
  { name: 'OfficeCity', type: 'Edm.String' },
  { name: 'OfficeStateOrProvince', type: 'Edm.String' },
  { name: 'OfficePostalCode', type: 'Edm.String' },
  { name: 'OfficeCountry', type: 'Edm.String' },
  { name: 'OfficePhone', type: 'Edm.String' },
  { name: 'OfficeFax', type: 'Edm.String' },
  { name: 'OfficeEmail', type: 'Edm.String' },
  { name: 'OfficeLatitude', type: 'Edm.Decimal' },
  { name: 'OfficeLongitude', type: 'Edm.Decimal' },
  { name: 'ModificationTimestamp', type: 'Edm.DateTimeOffset' }
]

function generateEntityType(name, fields, keyField) {
  const properties = fields.map(f => {
    const nullable = f.nullable === false ? ' Nullable="false"' : ''
    return `        <Property Name="${f.name}" Type="${f.type}"${nullable}/>`
  }).join('\n')

  return `      <EntityType Name="${name}">
        <Key>
          <PropertyRef Name="${keyField}"/>
        </Key>
${properties}
      </EntityType>`
}

function generateComplexType(name, fields) {
  const properties = fields.map(f => {
    return `        <Property Name="${f.name}" Type="${f.type}"/>`
  }).join('\n')

  return `      <ComplexType Name="${name}">
${properties}
      </ComplexType>`
}

function generateMetadata() {
  return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="${NAMESPACE}" xmlns="http://docs.oasis-open.org/odata/ns/edm">
${generateComplexType('Media', mediaFields)}
${generateEntityType('Property', propertyFields, 'ListingKey')}
${generateEntityType('Member', memberFields, 'MemberKey')}
${generateEntityType('Office', officeFields, 'OfficeKey')}
      <EntityContainer Name="Default">
        <EntitySet Name="Property" EntityType="${NAMESPACE}.Property"/>
        <EntitySet Name="Member" EntityType="${NAMESPACE}.Member"/>
        <EntitySet Name="Office" EntityType="${NAMESPACE}.Office"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
}

function handler(req, res) {
  res.set('Content-Type', 'application/xml')
  res.send(generateMetadata())
}

module.exports = {
  handler,
  propertyFields,
  memberFields,
  officeFields
}
