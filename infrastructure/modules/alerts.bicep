param baseName string
param tags object
param appInsightsId string
@description('E-Mail-Empfänger für Alarme. Leer = Action Group ohne Empfänger (nur im Portal sichtbar).')
param alertEmails array

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${baseName}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: take('mc${uniqueString(baseName)}', 12)
    enabled: true
    emailReceivers: [for (mail, i) in alertEmails: {
      name: 'mail${i}'
      emailAddress: mail
      useCommonAlertSchema: true
    }]
  }
}

resource exceptionsAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-${baseName}-exceptions'
  location: 'global'
  tags: tags
  properties: {
    description: 'Ungewöhnlich viele Exceptions in Function App.'
    severity: 2
    enabled: true
    scopes: [appInsightsId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'exceptions'
          metricNamespace: 'microsoft.insights/components'
          metricName: 'exceptions/count'
          operator: 'GreaterThan'
          threshold: 10
          timeAggregation: 'Count'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

// Der Poison-Queue-Handler der Anwendung loggt "Audit in Poison Queue" (Fehlerstufe).
resource poisonAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-${baseName}-poison'
  location: resourceGroup().location
  tags: tags
  properties: {
    displayName: 'Audit in Poison Queue'
    description: 'Mindestens ein Audit konnte nach allen Wiederholungen nicht verarbeitet werden.'
    severity: 2
    enabled: true
    scopes: [appInsightsId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'traces | where message has "Audit in Poison Queue"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}
