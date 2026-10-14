// Marketing Copilot – Website Auditor
// Scope: Resource Group (je Umgebung eine eigene: rg-mcopilot-dev / rg-mcopilot-prod).
// Nicht Teil dieses Templates (siehe docs/runbook.md):
//  - Entra-App-Registrierung (Client-ID/-Secret werden als Parameter übergeben)
//  - Wert des Secrets "anthropic-api-key" im Key Vault (wird manuell gesetzt)
targetScope = 'resourceGroup'

@allowed(['dev', 'prod'])
param environmentName string
param location string = resourceGroup().location
param workloadName string = 'mcopilot'

// --- Größen/Betrieb je Umgebung -------------------------------------------
@minValue(30)
param logRetentionDays int = 30
@allowed(['Standard_LRS', 'Standard_ZRS'])
param storageSkuName string = 'Standard_LRS'
param keyVaultPurgeProtection bool = false
param functionNodeVersion string = '22'
param functionMaximumInstanceCount int = 100
param functionInstanceMemoryMB int = 2048
param deployAlerts bool = false
param alertEmails array = []

// --- Anwendungskonfiguration -----------------------------------------------
@description('false, bis Anthropic-API-Key im Key Vault und AI_MODEL gesetzt sind.')
param aiEnabled bool = false
@description('Claude-Modell-ID. Bewusst ohne Default.')
param aiModel string = ''
param aiOutputLanguage string = 'Deutsch'
@description('Kommagetrennte Domain-Allowlist; leer = alle öffentlichen Ziele.')
param domainAllowlist string = ''
param auditTtlDays int = 90
param maxActiveAuditsPerUser int = 3
param maxAuditsPerUserPerDay int = 50
@description('Optionale zusätzliche Rolle (SWA-Rolle), die Benutzer haben müssen; leer = jeder Benutzer des Tenants.')
param allowedRole string = ''

// --- Authentifizierung (Entra ID) ------------------------------------------
param aadClientId string
@secure()
param aadClientSecret string

var baseName = '${workloadName}-${environmentName}'
var uniqueSuffix = take(uniqueString(resourceGroup().id), 5)
var tags = {
  workload: workloadName
  environment: environmentName
  managedBy: 'bicep'
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: { baseName: baseName, location: location, tags: tags, retentionInDays: logRetentionDays }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: { baseName: baseName, location: location, tags: tags, uniqueSuffix: uniqueSuffix, skuName: storageSkuName }
}

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: { baseName: baseName, location: location, tags: tags, uniqueSuffix: uniqueSuffix }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    baseName: baseName
    location: location
    tags: tags
    uniqueSuffix: uniqueSuffix
    enablePurgeProtection: keyVaultPurgeProtection
  }
}

module functionApp 'modules/functionapp.bicep' = {
  name: 'functionapp'
  params: {
    baseName: baseName
    location: location
    tags: tags
    nodeVersion: functionNodeVersion
    maximumInstanceCount: functionMaximumInstanceCount
    instanceMemoryMB: functionInstanceMemoryMB
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    storageAccountName: storage.outputs.name
    storageBlobEndpoint: storage.outputs.blobEndpoint
    deploymentContainerName: storage.outputs.deploymentContainerName
    auditQueueName: storage.outputs.auditQueueName
    cosmosEndpoint: cosmos.outputs.endpoint
    cosmosDatabase: cosmos.outputs.databaseName
    cosmosContainer: cosmos.outputs.containerName
    keyVaultUri: keyVault.outputs.uri
    anthropicSecretName: keyVault.outputs.anthropicSecretName
    app: {
      aiEnabled: aiEnabled
      aiModel: aiModel
      aiOutputLanguage: aiOutputLanguage
      domainAllowlist: domainAllowlist
      auditTtlDays: auditTtlDays
      maxActiveAuditsPerUser: maxActiveAuditsPerUser
      maxAuditsPerUserPerDay: maxAuditsPerUserPerDay
      allowedRole: allowedRole
    }
  }
}

module rbac 'modules/rbac.bicep' = {
  name: 'rbac'
  params: {
    functionPrincipalId: functionApp.outputs.principalId
    storageAccountName: storage.outputs.name
    keyVaultName: keyVault.outputs.name
    cosmosAccountName: cosmos.outputs.accountName
  }
}

module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'staticwebapp'
  params: {
    baseName: baseName
    location: location
    tags: tags
    functionAppId: functionApp.outputs.id
    functionAppLocation: location
    aadClientId: aadClientId
    aadClientSecret: aadClientSecret
  }
}

module alerts 'modules/alerts.bicep' = if (deployAlerts) {
  name: 'alerts'
  params: {
    baseName: baseName
    tags: tags
    appInsightsId: monitoring.outputs.appInsightsId
    alertEmails: alertEmails
  }
}

output staticWebAppName string = staticWebApp.outputs.name
output staticWebAppHostname string = staticWebApp.outputs.defaultHostname
output functionAppName string = functionApp.outputs.name
output keyVaultName string = keyVault.outputs.name
output cosmosAccountName string = cosmos.outputs.accountName
output storageAccountName string = storage.outputs.name
