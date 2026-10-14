param baseName string
param location string
param tags object
@description('Eindeutiges Suffix für globale Namen.')
param uniqueSuffix string
@allowed(['Standard_LRS', 'Standard_ZRS'])
param skuName string

var accountName = take(toLower('stmc${replace(baseName, '-', '')}${uniqueSuffix}'), 24)

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  sku: { name: skuName }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Zugriff ausschließlich per Entra ID / Managed Identity – keine Account-Keys.
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    accessTier: 'Hot'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

// Paketcontainer für das Flex-Consumption-Deployment der Function App.
resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'app-package'
  properties: { publicAccess: 'None' }
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource auditQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'audit-jobs'
}

// Wird vom Functions-Host bei maxDequeueCount automatisch befüllt.
resource poisonQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'audit-jobs-poison'
}

output name string = storage.name
output id string = storage.id
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output deploymentContainerName string = deploymentContainer.name
output auditQueueName string = auditQueue.name
