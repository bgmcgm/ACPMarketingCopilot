param baseName string
param location string
param tags object
param uniqueSuffix string
@description('Purge Protection ist unumkehrbar; in DEV bewusst abschaltbar, damit Neuaufbau möglich bleibt.')
param enablePurgeProtection bool

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('kv-${replace(baseName, 'mcopilot', 'mc')}-${uniqueSuffix}', 24)
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // Property darf nur true oder weggelassen werden.
    enablePurgeProtection: enablePurgeProtection ? true : null
    publicNetworkAccess: 'Enabled' // MVP; später Private Endpoint
  }
}

output name string = vault.name
output id string = vault.id
output uri string = vault.properties.vaultUri
@description('Name des Secrets mit dem Anthropic-API-Key. Der Wert wird manuell gesetzt (nicht per Bicep).')
output anthropicSecretName string = 'anthropic-api-key'
