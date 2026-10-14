using '../main.bicep'

param environmentName = 'prod'
param location = 'westeurope'

param logRetentionDays = 90
param storageSkuName = 'Standard_ZRS'
param keyVaultPurgeProtection = true
param deployAlerts = true
param alertEmails = []

param aiEnabled = false
param aiModel = ''

param aadClientId = '00000000-0000-0000-0000-000000000000'
param aadClientSecret = readEnvironmentVariable('AAD_CLIENT_SECRET', '')
