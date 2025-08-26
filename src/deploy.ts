import { existsSync } from 'fs'
import { createCertificate, getCertificateARN } from './acm'
import {
  DistributionIdentificationDetail,
  createCloudFrontDistribution,
  findDeployedCloudfrontDistribution,
  getCacheInvalidations,
  invalidateCloudfrontCacheWithRetry,
  updateCloudFrontDistribution,
  CloudFrontFunctionsAssignmentDefinition,
} from './cloudfront'
import {
  cleanExistingOriginAccessControl,
  upsertOriginAccessControl,
} from './cloudfront/origin-access'
import { logger } from './logger'
import { predeployPrompt } from './prompt'
import {
  createHostedZone,
  findHostedZone,
  needsUpdateRecord,
  updateRecord,
} from './route53'

import {
  allowBucketPublicAccess,
  blockBucketPublicAccess,
  confirmBucketManagement,
  createBucket,
  doesS3BucketExists,
  removeBucketWebsite,
  setBucketPolicy,
  setBucketPolicyForOAC,
  setBucketWebsite,
  syncToS3,
  tagBucket,
  upsertLifeCycleConfiguration,
} from './s3'

export const deploy = async (
  url: string,
  folder: string,
  wait: boolean,
  cacheInvalidations: string,
  cacheBustedPrefix: string | undefined,
  noPrompt: boolean,
  shouldBlockBucketPublicAccess: boolean,
  noDefaultRootObject: boolean,
  redirect403ToRoot: boolean,
  objectExpirationDays: number | null,
  cloudFrontFunctionsAssignments: CloudFrontFunctionsAssignmentDefinition
) => {
  await predeployPrompt(Boolean(process.env.CI), noPrompt)

  const [domainName, s3Folder] = url.split('/')

  logger.info(
    `✨ Deploying "${folder}" on "${domainName}" with path "${
      s3Folder || '/'
    }"...`
  )

  if (!existsSync(folder)) {
    throw new Error(`folder "${folder}" not found`)
  }
  if (!existsSync(`${folder}/index.html`)) {
    throw new Error(`"index.html" not found in "${folder}" folder`)
  }

  if (await doesS3BucketExists(domainName)) {
    await confirmBucketManagement(domainName)
  } else {
    await createBucket(domainName)

    // without this timeout `setBucketPolicy` fails with error
    // "The specified bucket does not exist"
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  await tagBucket(domainName)

  if (objectExpirationDays) {
    await upsertLifeCycleConfiguration(domainName, objectExpirationDays)
  }

  let hostedZone =
    (await findHostedZone(domainName)) || (await createHostedZone(domainName))

  let certificateArn = await getCertificateARN(domainName)
  if (!certificateArn) {
    if (!hostedZone.Id) {
      throw new Error(
        `[route53] hostedZone.Id is not defined for "${domainName}"`
      )
    }
    certificateArn = await createCertificate(domainName, hostedZone.Id)
  }

  let distribution: DistributionIdentificationDetail | null =
    await findDeployedCloudfrontDistribution(domainName)
  if (!distribution) {
    distribution = await createCloudFrontDistribution(
      domainName,
      certificateArn
    )
  }

  if (shouldBlockBucketPublicAccess) {
    const oac = await upsertOriginAccessControl(domainName, distribution.Id)
    await updateCloudFrontDistribution(distribution.Id, domainName, {
      cloudFrontFunctionsAssignments,
      shouldBlockBucketPublicAccess: true,
      noDefaultRootObject,
      oac,
      redirect403ToRoot,
    })
    await removeBucketWebsite(domainName)
    await blockBucketPublicAccess(domainName)
    await setBucketPolicyForOAC(domainName, distribution.Id)
  } else {
    await updateCloudFrontDistribution(distribution.Id, domainName, {
      cloudFrontFunctionsAssignments,
      shouldBlockBucketPublicAccess: false,
      noDefaultRootObject,
      oac: null,
      redirect403ToRoot,
    })
    await setBucketWebsite(domainName)
    await allowBucketPublicAccess(domainName)
    await setBucketPolicy(domainName)
    await cleanExistingOriginAccessControl(domainName, distribution.Id)
  }

  if (
    await needsUpdateRecord(hostedZone.Id, domainName, distribution.DomainName)
  ) {
    await updateRecord(hostedZone.Id, domainName, distribution.DomainName)
  }

  await syncToS3(folder, domainName, cacheBustedPrefix, s3Folder)

  await invalidateCloudfrontCacheWithRetry(
    distribution.Id,
    getCacheInvalidations(cacheInvalidations, s3Folder),
    wait
  )
}
