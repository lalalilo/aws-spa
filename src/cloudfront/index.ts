
import { AWSError } from 'aws-sdk'
import CloudFront, {
  DistributionConfig,
  DistributionSummary,
  Tag
} from 'aws-sdk/clients/cloudfront'
import { PromiseResult } from 'aws-sdk/lib/request'
import { getAll } from '../aws-helper'
import {
  cloudfront,
  getOriginId,
  getS3DomainName,
  getS3DomainNameForBlockedBucket,
} from '../aws-services'
import { logger } from '../logger'
import { DEFAULT_ROOT_OBJECT, NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR, NO_DEFAULT_ROOT_OBJECT_REDIRECTION_FUNCTION_NAME } from './constants'
import { noDefaultRootObjectFunctions } from './noDefaultRootObjectFunction'
import { OAC } from './origin-access'

export interface DistributionIdentificationDetail {
  Id: string
  ARN: string
  DomainName: string
}

export const findDeployedCloudfrontDistribution = async (
  domainName: string
) => {
  const distributions = await getAll<DistributionSummary>(
    async (nextMarker, page) => {
      logger.info(
        `[CloudFront] 🔍 Searching cloudfront distribution (page ${page})...`
      )

      const { DistributionList } = await cloudfront
        .listDistributions({
          Marker: nextMarker,
        })
        .promise()

      if (!DistributionList) {
        return { items: [], nextMarker: undefined }
      }

      return {
        items: DistributionList.Items || [],
        nextMarker: DistributionList.NextMarker,
      }
    }
  )

  const distribution = distributions.find(_distribution =>
    Boolean(
      _distribution.Aliases.Items &&
        _distribution.Aliases.Items.includes(domainName)
    )
  )

  if (!distribution) {
    logger.info(`[CloudFront] 😬 No matching distribution`)
    return null
  }

  const { Tags } = await cloudfront
    .listTagsForResource({ Resource: distribution.ARN })
    .promise()
  if (
    !Tags ||
    !Tags.Items ||
    !Tags.Items.find(
      tag =>
        tag.Key === identifyingTag.Key && tag.Value === identifyingTag.Value
    )
  ) {
    throw new Error(
      `CloudFront distribution ${distribution.Id} has no tag ${identifyingTag.Key}:${identifyingTag.Value}`
    )
  }

  logger.info(`[CloudFront] 👍 Distribution found: ${distribution.Id}`)

  if (['InProgress', 'In Progress'].includes(distribution.Status)) {
    logger.info(
      `[CloudFront] ⏱ Waiting for distribution to be deployed. This step might takes up to 25 minutes...`
    )
    await cloudfront
      .waitFor('distributionDeployed', { Id: distribution.Id })
      .promise().then(() => {
        logger.info(`[CloudFront] ✅ Distribution deployed: ${distribution.Id}`)
      })
  }

  logger.info(`[CloudFront] ✅ Using distribution: ${distribution.Id}`)
  return distribution
}

export const tagCloudFrontDistribution = async (
  distribution: DistributionIdentificationDetail
) => {
  logger.info(
    `[CloudFront] ✏️ Tagging "${distribution.Id}" bucket with "${identifyingTag.Key}:${identifyingTag.Value}"...`
  )
  await cloudfront
    .tagResource({
      Resource: distribution.ARN,
      Tags: {
        Items: [identifyingTag],
      },
    })
    .promise()
}

export const createCloudFrontDistribution = async (
  domainName: string,
  sslCertificateARN: string,
): Promise<DistributionIdentificationDetail> => {
  logger.info(
    `[CloudFront] ✏️ Creating Cloudfront distribution with origin "${getS3DomainName(
      domainName
    )}"...`
  )

  const { Distribution } = await cloudfront
    .createDistribution({
      DistributionConfig: getBaseDistributionConfig(
        domainName,
        sslCertificateARN,
      ),
    })
    .promise()

  if (!Distribution) {
    throw new Error('[CloudFront] Could not create distribution')
  }

  await tagCloudFrontDistribution(Distribution)

  logger.info(
    `[CloudFront] ⏱ Waiting for distribution to be available. This step might takes up to 25 minutes...`
  )
  await cloudfront
    .waitFor('distributionDeployed', { Id: Distribution.Id })
    .promise()

  return Distribution
}

const createAndPublishNoDefaultRootObjectRedirectionFunction = async () => {
  const cloudFrontRedirectionFunctionName =
    NO_DEFAULT_ROOT_OBJECT_REDIRECTION_FUNCTION_NAME +
    '_' +
    NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR

    const currentFunctionARN = await isCloudFrontFunctionExisting(
      cloudFrontRedirectionFunctionName
    )

  if (!currentFunctionARN) {
    const { createdFunctionETag, createdFunctionARN } =
      await createNoDefaultRootObjectFunction(cloudFrontRedirectionFunctionName)

    if (!createdFunctionARN ) {
      throw new Error(
        `[CloudFront] Could not create function to handle redirection when no default root object. No ARN returned.`
      )
    }

    if (!createdFunctionETag) {
      throw new Error(
        `[CloudFront] Could not create function to handle redirection when no default root object. No Etag returned.`
      )
    }
  
    await publishCloudFrontFunction(
      cloudFrontRedirectionFunctionName,
      createdFunctionETag
    )

    return createdFunctionARN
  }

  return currentFunctionARN
}

const isCloudFrontFunctionExisting = async (name: string) => {
  let existingFunctionARN: string | undefined
  await cloudfront
    .listFunctions((err, data) => {
      if (err) {
        logger.error(`[CloudFront] Error listing functions: ${err}`)
      }
      existingFunctionARN = data.FunctionList?.Items?.find(item => item.Name === name)?.FunctionMetadata.FunctionARN
    })
    .promise()
  return existingFunctionARN
}

const createNoDefaultRootObjectFunction = async (functionName: string) => {
  logger.info(
    `[CloudFront] ✏️ Creating function to handle redirection when no default root object...`
  )
  let createdFunctionETag: string | undefined
  let createdFunctionARN: string | undefined
  const data = await cloudfront
    .createFunction(
      {
        Name: functionName,
        FunctionCode: noDefaultRootObjectFunctions[NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR],
        FunctionConfig: {
          Runtime: 'cloudfront-js-2.0',
          Comment:
            'Redirects to branch specific index.html when no default root object is set',
        },
      },
      (err) => {
        if (err) {
          logger.error(`[CloudFront] Error creating function: ${err}`)
        }
      }
    )
    .promise()
    createdFunctionARN = data.FunctionSummary?.FunctionMetadata.FunctionARN
    createdFunctionETag = data.ETag
  return { createdFunctionETag, createdFunctionARN }
}

const publishCloudFrontFunction = async (name: string, etag: string) => {
  logger.info(
    `[CloudFront] ✏️ Publish function to handle redirection when no default root object...`
  )
  await cloudfront
    .publishFunction(
      {
        Name: name,
        IfMatch: etag,
      },
      err => {
        if (err) {
          throw new Error(`[CloudFront] Error publishing function: ${err}`)
        }
      }
    )
    .promise()
}

const getBaseDistributionConfig = (
  domainName: string,
  sslCertificateARN: string,
): DistributionConfig => ({
  CallerReference: Date.now().toString(),
  Aliases: {
    Quantity: 1,
    Items: [domainName],
  },
  Origins: {
    Quantity: 1,
    Items: [
      {
        Id: getOriginId(domainName),
        DomainName: getS3DomainName(domainName),
        CustomOriginConfig: {
          HTTPPort: 80,
          HTTPSPort: 443,
          OriginProtocolPolicy: 'http-only',
          OriginSslProtocols: {
            Quantity: 1,
            Items: ['TLSv1'],
          },
          OriginReadTimeout: 30,
          OriginKeepaliveTimeout: 5,
        },
        CustomHeaders: {
          Quantity: 0,
          Items: [],
        },
        OriginPath: '',
      },
    ],
  },
  Enabled: true,
  Comment: '',
  PriceClass: 'PriceClass_All',
  Logging: {
    Enabled: false,
    IncludeCookies: false,
    Bucket: '',
    Prefix: '',
  },
  CacheBehaviors: {
    Quantity: 0,
  },
  CustomErrorResponses: {
    Quantity: 0,
  },
  Restrictions: {
    GeoRestriction: {
      RestrictionType: 'none',
      Quantity: 0,
    },
  },
  DefaultRootObject: DEFAULT_ROOT_OBJECT,
  WebACLId: '',
  HttpVersion: 'http2',
  DefaultCacheBehavior: {
    ViewerProtocolPolicy: 'redirect-to-https',
    TargetOriginId: getOriginId(domainName),
    ForwardedValues: {
      QueryString: false,
      Cookies: {
        Forward: 'none',
      },
      Headers: {
        Quantity: 0,
        Items: [],
      },
      QueryStringCacheKeys: {
        Quantity: 0,
        Items: [],
      },
    },
    AllowedMethods: {
      Quantity: 2,
      Items: ['HEAD', 'GET'],
      CachedMethods: {
        Quantity: 2,
        Items: ['HEAD', 'GET'],
      },
    },
    TrustedSigners: {
      Enabled: false,
      Quantity: 0,
    },
    MinTTL: 0,
    DefaultTTL: 86400,
    MaxTTL: 31536000,
    FieldLevelEncryptionId: '',
    LambdaFunctionAssociations: {
      Quantity: 0,
      Items: [],
    },
    SmoothStreaming: false,
    Compress: true, // this is required to deliver gzip data
  },
  ViewerCertificate: {
    ACMCertificateArn: sslCertificateARN,
    SSLSupportMethod: 'sni-only',
    MinimumProtocolVersion: 'TLSv1.1_2016',
    CertificateSource: 'acm',
  },
})

export const invalidateCloudfrontCache = async (
  distributionId: string,
  paths: string,
  wait: boolean = false
) => {
  logger.info('[CloudFront] ✏️ Creating invalidation...')
  const { Invalidation } = await cloudfront
    .createInvalidation({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: {
          Quantity: paths.split(',').length,
          Items: paths.split(',').map(path => path.trim()),
        },
      },
    })
    .promise()

  if (!Invalidation) {
    return
  }

  if (wait) {
    logger.info(
      '[CloudFront] ⏱ Waiting for invalidation to be completed (can take up to 10 minutes)...'
    )
    await cloudfront
      .waitFor('invalidationCompleted', {
        DistributionId: distributionId,
        Id: Invalidation.Id,
      })
      .promise()
  }
}

export const invalidateCloudfrontCacheWithRetry = async (
  distributionId: string,
  paths: string,
  wait: boolean = false,
  count: number = 0
): Promise<PromiseResult<
  CloudFront.GetInvalidationResult,
  AWSError
> | void> => {
  try {
    return await invalidateCloudfrontCache(distributionId, paths, wait)
  } catch (error) {
    if (count < 4) {
      return await invalidateCloudfrontCacheWithRetry(
        distributionId,
        paths,
        wait,
        count + 1
      )
    }
    throw error
  }
}

export const identifyingTag: Tag = {
  Key: 'managed-by-aws-spa',
  Value: 'v1',
}

export const getCacheInvalidations = (
  cacheInvalidations: string,
  subFolder: string | undefined
) =>
  cacheInvalidations
    .split(',')
    .map(string => string.trim().replace(/^\//, ''))
    .map(string => (subFolder ? `/${subFolder}/${string}` : `/${string}`))
    .join(',')

type UpdateCloudFrontDistributionOptions = {
  shouldBlockBucketPublicAccess: true
  noDefaultRootObject: boolean
  oac: OAC
} | {
  shouldBlockBucketPublicAccess: false
  noDefaultRootObject: boolean
  oac: null
}

export const updateCloudFrontDistribution = async (
  distributionId: string,
  domainName: string,
  options: UpdateCloudFrontDistributionOptions
) => {
  const { shouldBlockBucketPublicAccess, oac, noDefaultRootObject } = options
  try {
    let functionARN: string | undefined
    let updatedDistributionConfig: CloudFront.DistributionConfig
    
    const { DistributionConfig, ETag } = await cloudfront
    .getDistributionConfig({ Id: distributionId })
    .promise()
    
    if (noDefaultRootObject) {
      functionARN =
        await createAndPublishNoDefaultRootObjectRedirectionFunction()
        updatedDistributionConfig = addFunctionToDistribution(DistributionConfig!, functionARN)
    } else {
      updatedDistributionConfig = ensureFunctionIsNotAssociated(DistributionConfig!)
    }

    logger.info(
      `[Cloudfront] ✏️ Update distribution configuration "${distributionId}"...`
    )
    
    if (shouldBlockBucketPublicAccess) {
      updatedDistributionConfig = makeBucketPrivate(
        domainName,
        updatedDistributionConfig,
        oac.originAccessControl.Id)
    } else {
      updatedDistributionConfig = makeBucketPublic(updatedDistributionConfig, domainName)
    }

    const shouldUpdateDistribution = isDistributionConfigModified(DistributionConfig!, updatedDistributionConfig)

    if (!shouldUpdateDistribution) {
      logger.info(
        `[Cloudfront] 👍 No updates needed for distribution "${distributionId}"`        
      )
      return
    }

    await cloudfront
      .updateDistribution({
        Id: distributionId,
        IfMatch: ETag,
        DistributionConfig: updatedDistributionConfig,
      })
      .promise()
  } catch (error) {
    throw error
  }
}

const isDistributionConfigModified = (
  updatedDistributionConfig: CloudFront.DistributionConfig,
  distributionConfig: CloudFront.DistributionConfig
): boolean => JSON.stringify(updatedDistributionConfig) !== JSON.stringify(distributionConfig)

const addFunctionToDistribution = (
  distributionConfig: CloudFront.DistributionConfig,
  functionARN: string
): CloudFront.DistributionConfig => ({
  ...distributionConfig,
  DefaultRootObject: '',
  DefaultCacheBehavior: {...distributionConfig.DefaultCacheBehavior,
    FunctionAssociations: {
      Quantity: 1,
      Items: [{
        FunctionARN: functionARN,
        EventType: 'viewer-request',
      }],
    },
  },
})

const ensureFunctionIsNotAssociated = (
  distributionConfig: CloudFront.DistributionConfig,
) => {
  const configWithoutFunctions = {
    ...distributionConfig,
    DefaultRootObject: DEFAULT_ROOT_OBJECT,
  }
  delete configWithoutFunctions.DefaultCacheBehavior.FunctionAssociations
  return configWithoutFunctions
}

const makeBucketPrivate = (domainName: string,distributionConfig: CloudFront.DistributionConfig, originAccessControlId: string) => {
  const isOACAlreadyAssociated = distributionConfig?.Origins.Items.find(
    o => o.DomainName === getS3DomainNameForBlockedBucket(domainName)
  )

  if (isOACAlreadyAssociated) {
    return distributionConfig
  }

  return {
    ...distributionConfig,
    Origins: {
      ...distributionConfig.Origins,
      Quantity: 1,
      Items: [
        {
          Id: getS3DomainNameForBlockedBucket(domainName),
          DomainName: getS3DomainNameForBlockedBucket(domainName),
          OriginAccessControlId: originAccessControlId,
          S3OriginConfig: {
            OriginAccessIdentity: '', // If you're using origin access control (OAC) instead of origin access identity, specify an empty OriginAccessIdentity element
          },
          OriginPath: '',
          CustomHeaders: {
            Quantity: 0,
            Items: [],
          },
        },
      ],
    },
    DefaultCacheBehavior: {
      ...distributionConfig.DefaultCacheBehavior,
      TargetOriginId: getS3DomainNameForBlockedBucket(domainName),
    },
  }
}

const makeBucketPublic = (distributionConfig: CloudFront.DistributionConfig,
  domainName: string,
) => {
  const isS3WebsiteAlreadyAssociated = distributionConfig?.Origins.Items.find(
    o => o.DomainName === getS3DomainName(domainName)
  )

  if (isS3WebsiteAlreadyAssociated) {
    return distributionConfig
  }

  return {
    ...distributionConfig,
    Origins: {
      ...distributionConfig.Origins,
      Quantity: 1,
      Items: [
        {
          Id: getOriginId(domainName),
          DomainName: getS3DomainName(domainName),
          CustomOriginConfig: {
            HTTPPort: 80,
            HTTPSPort: 443,
            OriginProtocolPolicy: 'http-only',
            OriginSslProtocols: {
              Quantity: 1,
              Items: ['TLSv1'],
            },
            OriginReadTimeout: 30,
            OriginKeepaliveTimeout: 5,
          },
          CustomHeaders: {
            Quantity: 0,
            Items: [],
          },
          OriginPath: '',
        },
      ],
    },
    DefaultCacheBehavior: {
      ...distributionConfig.DefaultCacheBehavior,
      TargetOriginId: getOriginId(domainName),
    },
  }
}
