param baseName string
param location string
param tags object
param nodeVersion string
param maximumInstanceCount int
param instanceMemoryMB int

param appInsightsConnectionString string
param storageAccountName string
param storageBlobEndpoint string
param deploymentContainerName string
param auditQueueName string
param cosmosEndpoint string
param cosmosDatabase string
param cosmosContainer string
param keyVaultUri string
param anthropicSecretName string

@description('Anwendungskonfiguration (siehe docs/ARCHITECTURE.md, Abschnitt 9).')
param app object

// Flex Consumption: Identitätsbasierter Storage-Zugriff, Paket-Deployment per Blob-Container.
// [ANNAHME] Kompatibilität von Flex Consumption mit dem SWA-Linked-Backend vor dem ersten Deploy prüfen.
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'asp-${baseName}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: 'func-${baseName}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageBlobEndpoint}${deploymentContainerName}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
      }
      runtime: { name: 'node', version: nodeVersion }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storageAccountName }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
        { name: 'COSMOS_DATABASE', value: cosmosDatabase }
        { name: 'COSMOS_CONTAINER', value: cosmosContainer }
        { name: 'STORAGE_QUEUE_ACCOUNT_NAME', value: storageAccountName }
        { name: 'AUDIT_QUEUE_NAME', value: auditQueueName }
        // Key-Vault-Referenz (versionslos): Der Secret-Wert wird manuell im Key Vault gesetzt.
        { name: 'ANTHROPIC_API_KEY', value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/${anthropicSecretName}/)' }
        { name: 'AI_ENABLED', value: string(app.aiEnabled) }
        { name: 'AI_MODEL', value: app.aiModel }
        { name: 'AI_OUTPUT_LANGUAGE', value: app.aiOutputLanguage }
        { name: 'DOMAIN_ALLOWLIST', value: app.domainAllowlist }
        { name: 'AUDIT_TTL_DAYS', value: string(app.auditTtlDays) }
        { name: 'MAX_ACTIVE_AUDITS_PER_USER', value: string(app.maxActiveAuditsPerUser) }
        { name: 'MAX_AUDITS_PER_USER_PER_DAY', value: string(app.maxAuditsPerUserPerDay) }
        { name: 'ALLOWED_ROLE', value: app.allowedRole }
      ]
    }
  }
}

output name string = functionApp.name
output id string = functionApp.id
output defaultHostname string = functionApp.properties.defaultHostName
output principalId string = functionApp.identity.principalId
