param baseName string
param location string
param tags object
param uniqueSuffix string
param databaseName string = 'marketingcopilot'
param containerName string = 'audits'

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: take('cosmos-${baseName}-${uniqueSuffix}', 44)
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [{ locationName: location, failoverPriority: 0, isZoneRedundant: false }]
    // Nur Entra-ID-Authentifizierung (Data-Plane-RBAC), keine Keys.
    disableLocalAuth: true
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled' // MVP; später Private Endpoint
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: account
  name: databaseName
  properties: { resource: { id: databaseName } }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: { paths: ['/ownerId'], kind: 'Hash', version: 2 }
      // TTL pro Dokument (Feld "ttl"); -1 = aktiv, Dokumente ohne ttl laufen nicht ab.
      defaultTtl: -1
      // Nur Felder indexieren, die in Abfragen gefiltert/sortiert werden.
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          { path: '/ownerId/?' }
          { path: '/type/?' }
          { path: '/status/?' }
          { path: '/createdAt/?' }
        ]
        excludedPaths: [{ path: '/*' }]
      }
    }
  }
}

output accountName string = account.name
output accountId string = account.id
output endpoint string = account.properties.documentEndpoint
output databaseName string = database.name
output containerName string = container.name
