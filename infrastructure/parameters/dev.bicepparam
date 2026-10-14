using '../main.bicep'

param environmentName = 'dev'
param location = 'westeurope'

param logRetentionDays = 30
param storageSkuName = 'Standard_LRS'
param keyVaultPurgeProtection = false
param deployAlerts = false

// KI bleibt aus, bis der Key im Key Vault liegt und das Modell feststeht (docs/runbook.md).
param aiEnabled = false
param aiModel = ''

// Entra-App-Registrierung (Client-ID ist kein Secret). Der Client-Secret wird NICHT hier,
// sondern beim Deployment als sicherer Parameter übergeben (aadClientSecret).
param aadClientId = '00000000-0000-0000-0000-000000000000'
param aadClientSecret = readEnvironmentVariable('AAD_CLIENT_SECRET', '')
