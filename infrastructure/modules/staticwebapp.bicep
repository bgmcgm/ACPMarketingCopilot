param baseName string
param location string
param tags object
param functionAppId string
param functionAppLocation string
param aadClientId string
@secure()
param aadClientSecret string

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'swa-${baseName}'
  location: location
  tags: tags
  // Standard ist für Custom-OIDC-Login und Linked Backend erforderlich.
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {
    // Deployment erfolgt per Pipeline (SWA CLI / Deployment Token), nicht per Repo-Anbindung.
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Disabled'
  }
}

// Verknüpft die Function App als API unter /api.
resource linkedBackend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: swa
  name: 'api'
  properties: {
    backendResourceId: functionAppId
    region: functionAppLocation
  }
}

// App Settings für den Custom-OIDC-Provider "aad" (staticwebapp.config.json).
// Der Client-Secret kommt als sicherer Deployment-Parameter aus der Pipeline, nie aus dem Repository.
resource appSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    AAD_CLIENT_ID: aadClientId
    AAD_CLIENT_SECRET: aadClientSecret
  }
}

output name string = swa.name
output defaultHostname string = swa.properties.defaultHostname
