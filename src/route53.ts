import { ResourceRecord } from '@aws-sdk/client-acm'
import { HostedZone } from '@aws-sdk/client-route-53'
import inquirer from 'inquirer'
import { getAll } from './aws-helper'
import { route53 } from './aws-services'
import { logger } from './logger'

export const findHostedZone = async (domainName: string) => {
  logger.info(
    `[route53] 🔍 Looking for a hosted zone matching "${domainName}"...`
  )

  const hostedZones = await getAll<HostedZone>(async (nextMarker, page) => {
    logger.info(`[route53] 🔍 List hosted zones (page ${page})...`)
    const { HostedZones, NextMarker } = await route53.listHostedZones({ Marker: nextMarker })
    if (!HostedZones) {
      logger.info(`[route53] 🧐 No hosted zones found`)
      return { items: [], nextMarker: undefined }
    }
    return { items: HostedZones, nextMarker: NextMarker }
  })

  const matchingHostedZones = hostedZones.filter(hostedZone =>
    domainName.endsWith(hostedZone.Name!.replace(/\.$/g, ''))
  )

  if (matchingHostedZones.length === 1) {
    logger.info(
      `[route53] 👍 Found Hosted zone: "${matchingHostedZones[0].Name}"`
    )
    return matchingHostedZones[0]
  }

  if (matchingHostedZones.length > 1) {
    logger.warn(
      `[route53] ⚠️ Found multiple hosted zones: ${matchingHostedZones
        .map(hostedZone => `"${hostedZone.Name}"`)
        .join(
          ', '
        )}. There first hosted zone will be used. If this is an issue, please open an issue on https://github.com/lalalilo/aws-spa/issues`
    )
    return matchingHostedZones[0]
  }

  logger.info(`[route53] 🧐 No matching hosted zones found`)
  return null
}

export const createHostedZone = async (domainName: string) => {
  logger.info(`[route53] ✏️ Creating hosted zone "${domainName}"...`)
  const { HostedZone } = await route53.createHostedZone({
      Name: domainName,
      CallerReference: `aws-spa-${Date.now()}`,
    })

  if (!HostedZone) {
    throw new Error(`[route53] ❌ Failed to create hosted zone "${domainName}"`)
  }

  return HostedZone
}

export const needsUpdateRecord = async (
  hostedZoneId: string | undefined,
  domainName: string,
  cloudfrontDomainName: string
) => {
  if (!hostedZoneId) {
    logger.warn(`[route53] 🧐 hostedZoneId is undefined`)
    return false
  }  

  logger.info(`[route53] 🔍 Looking for a matching record...`)

  const { ResourceRecordSets } = await route53.listResourceRecordSets({
      HostedZoneId: hostedZoneId,
      StartRecordName: domainName,
    })

  if (!ResourceRecordSets || ResourceRecordSets.length === 0) {
    logger.info(`[route53] 🔍 No matching record found.`)
    return true
  }

  for (const record of ResourceRecordSets) {
    if (record.Name !== `${domainName}.`) {
      continue
    }

    if (record.Type === 'CNAME' && record.ResourceRecords) {
      if (record.ResourceRecords[0].Value === `${cloudfrontDomainName}.`) {
        logger.info(`[route53] 👍 Found well configured CNAME matching record`)
        return false
      }

      const { continueUpdate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueUpdate',
          message: `[Route53] CNAME Record for "${domainName}" value is "${record.ResourceRecords[0].Value}". Would you like to update it to "${cloudfrontDomainName}."?`,
          default: false,
        },
      ])
      if (continueUpdate) {
        return true
      } else {
        logger.warn(
          '⚠️ website might not be served correctly unless you allow route53 record update'
        )
        return false
      }
    }

    if (record.Type === 'A' && record.AliasTarget) {
      if (
        record.AliasTarget.HostedZoneId === 'Z2FDTNDATAQYW2' &&
        record.AliasTarget.DNSName === `${cloudfrontDomainName}.`
      ) {
        logger.info(`[route53] 👍 Found well configured A matching record`)
        return false
      }

      const { continueUpdate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueUpdate',
          message: `[Route53] A Record for "${domainName}" value is "${record.AliasTarget.HostedZoneId}:${record.AliasTarget.DNSName}". Would you like to update it to "${record.AliasTarget.HostedZoneId}:${cloudfrontDomainName}."?`,
          default: false,
        },
      ])
      if (continueUpdate) {
        return true
      } else {
        logger.warn(
          '⚠️ website might not be served correctly unless you allow route53 record update'
        )
        return false
      }
    }
  }
}

export const updateRecord = async (
  hostedZoneId: string | undefined,
  domainName: string,
  cloudfrontDomainName: string
) => {
  if (!hostedZoneId) {
    throw new Error(`[route53] ❌ hostedZoneId is undefined`)
  }

  logger.info(
    `[route53] ✏️ Upserting A: "${domainName}." → ${cloudfrontDomainName}...`
  )
  await route53.changeResourceRecordSets({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: `${domainName}.`,
              AliasTarget: {
                HostedZoneId: 'Z2FDTNDATAQYW2', // https://docs.aws.amazon.com/general/latest/gr/rande.html#cf_region
                DNSName: `${cloudfrontDomainName}.`,
                EvaluateTargetHealth: false,
              },
              Type: 'A',
            },
          },
        ],
      },
    })
}

export const createCertificateValidationDNSRecord = async (
  record: ResourceRecord,
  hostedZoneId: string
) => {
  logger.info(
    `[Route53] Creating record ${record.Type}:${record.Name}=${record.Value} to validate SSL certificate`
  )
  await route53.changeResourceRecordSets({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: record.Name,
              Type: record.Type,
              ResourceRecords: [{ Value: record.Value }],
              TTL: 3600,
            },
          },
        ],
      },
    })
}
