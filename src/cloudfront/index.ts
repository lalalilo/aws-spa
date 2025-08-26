import {
  Distribution,
  DistributionConfig,
  DistributionSummary,
  EventType,
  FunctionStage,
  GetInvalidationCommandOutput,
  OriginProtocolPolicy,
  Tag,
} from '@aws-sdk/client-cloudfront'
import { getAll } from '../aws-helper'
import {
  cloudfront,
  getOriginId,
  getS3DomainName,
  getS3DomainNameForBlockedBucket,
  waitUntil,
} from '../aws-services'
import { logger } from '../logger'
import {
  DEFAULT_ROOT_OBJECT,
  NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR,
  NO_DEFAULT_ROOT_OBJECT_REDIRECTION_FUNCTION_NAME,
} from './constants'
import { noDefaultRootObjectFunctions } from './noDefaultRootObjectFunction'
import { OAC } from './origin-access'

export interface DistributionIdentificationDetail {
  Id: string
  ARN: string
  DomainName: string
}

export const findDeployedCloudfrontDistribution = async (
  domainName: string
): Promise<(DistributionSummary & DistributionIdentificationDetail) | null> => {
  const distributions = await getAll<DistributionSummary>(
    async (nextMarker, page) => {
      logger.info(
        `[CloudFront] 🔍 Searching cloudfront distribution (page ${page})...`
      )

      const { DistributionList } = await cloudfront.listDistributions({
        Marker: nextMarker,
      })

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
      _distribution.Aliases?.Items &&
        _distribution.Aliases.Items.includes(domainName)
    )
  )

  if (!distribution) {
    logger.info(`[CloudFront] 😬 No matching distribution`)
    return null
  }

  if (!distribution.Id) {
    throw new Error('[CloudFront] Distribution has no ID')
  }

  const { Tags } = await cloudfront.listTagsForResource({
    Resource: distribution.ARN,
  })

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

  if (!distribution.Status) {
    throw new Error(
      `[CloudFront] Distribution ${distribution.Id} has no status`
    )
  }

  if (['InProgress', 'In Progress'].includes(distribution.Status)) {
    logger.info(
      `[CloudFront] ⏱ Waiting for distribution to be deployed. This step might takes up to 25 minutes...`
    )
    await waitUntil.distributionDeployed(
      {
        client: cloudfront,
        maxWaitTime: 1500,
      },
      { Id: distribution.Id }
    )

    logger.info(`[CloudFront] ✅ Distribution deployed: ${distribution.Id}`)
  }

  logger.info(`[CloudFront] ✅ Using distribution: ${distribution.Id}`)
  return {
    ...distribution,
    Id: distribution.Id!,
    ARN: distribution.ARN!,
    DomainName: distribution.DomainName!,
  }
}

const tagCloudFrontDistribution = async (distribution: Distribution) => {
  logger.info(
    `[CloudFront] ✏️ Tagging "${distribution.Id}" bucket with "${identifyingTag.Key}:${identifyingTag.Value}"...`
  )
  await cloudfront.tagResource({
    Resource: distribution.ARN,
    Tags: {
      Items: [identifyingTag],
    },
  })
}

export const createCloudFrontDistribution = async (
  domainName: string,
  sslCertificateARN: string
): Promise<Distribution & DistributionIdentificationDetail> => {
  logger.info(
    `[CloudFront] ✏️ Creating Cloudfront distribution with origin "${getS3DomainName(
      domainName
    )}"...`
  )

  const { Distribution } = await cloudfront.createDistribution({
    DistributionConfig: getBaseDistributionConfig(
      domainName,
      sslCertificateARN
    ),
  })

  if (!Distribution) {
    throw new Error('[CloudFront] Could not create distribution')
  }

  if (!Distribution.Id) {
    throw new Error('[CloudFront] Distribution has no ID')
  }

  await tagCloudFrontDistribution(Distribution)

  logger.info(
    `[CloudFront] ⏱ Waiting for distribution to be available. This step might takes up to 25 minutes...`
  )

  await waitUntil.distributionDeployed(
    {
      client: cloudfront,
      maxWaitTime: 1500,
    },
    { Id: Distribution.Id }
  )
  logger.info(`[CloudFront] ✅ Distribution deployed: ${Distribution.Id}`)

  return {
    ...Distribution,
    Id: Distribution.Id!,
    ARN: Distribution.ARN!,
    DomainName: Distribution.DomainName!,
  }
}

const createAndPublishNoDefaultRootObjectRedirectionFunction = async () => {
  const cloudFrontRedirectionFunctionName =
    NO_DEFAULT_ROOT_OBJECT_REDIRECTION_FUNCTION_NAME +
    '_' +
    NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR

  const currentFunctionARN = await getCloudFrontFunctionARN(
    cloudFrontRedirectionFunctionName
  )

  if (!currentFunctionARN) {
    const { createdFunctionETag, createdFunctionARN } =
      await createNoDefaultRootObjectFunction(cloudFrontRedirectionFunctionName)

    if (!createdFunctionARN) {
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

const getCloudFrontFunctionARN = async (name: string) => {
  try {
    const { FunctionList } = await cloudfront.listFunctions()

    const existingFunctionARN = FunctionList?.Items?.sort(
      (a, b) =>
        (b.FunctionMetadata?.LastModifiedTime?.getTime() ?? 0) -
        (a.FunctionMetadata?.LastModifiedTime?.getTime() ?? 0)
    ).find(
      item =>
        item.Name === name &&
        item.FunctionMetadata?.Stage === FunctionStage.LIVE
    )?.FunctionMetadata?.FunctionARN

    return existingFunctionARN
  } catch (error) {
    throw new Error(`[CloudFront] Error listing functions: ${error}`)
  }
}

const createNoDefaultRootObjectFunction = async (functionName: string) => {
  logger.info(
    `[CloudFront] ✏️ Creating function to handle redirection when no default root object...`
  )
  let createdFunctionETag: string | undefined
  let createdFunctionARN: string | undefined
  try {
    const data = await cloudfront.createFunction({
      Name: functionName,
      FunctionCode: new TextEncoder().encode(
        noDefaultRootObjectFunctions[NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR]
      ),
      FunctionConfig: {
        Runtime: 'cloudfront-js-2.0',
        Comment:
          'Redirects to branch specific index.html when no default root object is set',
      },
    })
    createdFunctionARN = data.FunctionSummary?.FunctionMetadata?.FunctionARN
    createdFunctionETag = data.ETag
    return { createdFunctionETag, createdFunctionARN }
  } catch (error) {
    throw new Error(`[CloudFront] Error creating function: ${error}`)
  }
}

const publishCloudFrontFunction = async (name: string, etag: string) => {
  logger.info(
    `[CloudFront] ✏️ Publish function to handle redirection when no default root object...`
  )
  await cloudfront.publishFunction(
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
}

const getBaseDistributionConfig = (
  domainName: string,
  sslCertificateARN: string
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

const clearDistributionConfigurationFunctions = (
  distributionConfig: DistributionConfig
): DistributionConfig => {
  return {
    ...distributionConfig,
    DefaultCacheBehavior: {
      ...distributionConfig.DefaultCacheBehavior!,
      FunctionAssociations: {
        Quantity: 0,
        Items: [],
      },
    },
  }
}

export type CloudFrontFunctionsAssignmentDefinition = Record<
  EventType,
  string[]
>

const assignFunctionsToDistribution = async (
  distributionConfig: DistributionConfig,
  functionAssignmentDefinitions: CloudFrontFunctionsAssignmentDefinition
): Promise<DistributionConfig> => {
  let updatedDistributionConfig = distributionConfig
  for (const [eventType, functionNames] of Object.entries(
    functionAssignmentDefinitions
  )) {
    for (const functionName of functionNames) {
      const functionARN = await getCloudFrontFunctionARN(functionName)

      if (!functionARN) {
        throw new Error(
          `[CloudFront] Requested CloudFront function "${functionName}" does not exists.`
        )
      }

      updatedDistributionConfig = addFunctionToDistribution(
        updatedDistributionConfig,
        functionARN,
        eventType as EventType
      )
    }
  }
  return updatedDistributionConfig
}

export const invalidateCloudfrontCache = async (
  distributionId: string,
  paths: string,
  wait: boolean = false
) => {
  logger.info('[CloudFront] ✏️ Creating invalidation...')

  const { Invalidation } = await cloudfront.createInvalidation({
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: Date.now().toString(),
      Paths: {
        Quantity: paths.split(',').length,
        Items: paths.split(',').map(path => path.trim()),
      },
    },
  })

  if (!Invalidation) {
    return
  }

  if (wait) {
    logger.info(
      '[CloudFront] ⏱ Waiting for invalidation to be completed (can take up to 10 minutes)...'
    )

    await waitUntil.invalidationCompleted(
      {
        client: cloudfront,
        maxWaitTime: 600,
      },
      { DistributionId: distributionId, Id: Invalidation.Id }
    )
    logger.info('[CloudFront] ✅ Invalidation completed')
  }
}

export const invalidateCloudfrontCacheWithRetry = async (
  distributionId: string,
  paths: string,
  wait: boolean = false,
  count: number = 0
): Promise<GetInvalidationCommandOutput | void> => {
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

type CommonUpdateCloudFrontDistributionOptions = {
  additionalDomainNames: string[]
  cloudFrontFunctionsAssignments: CloudFrontFunctionsAssignmentDefinition
}
type SpecificUpdateCloudFrontDistributionOptions =
  | {
      shouldBlockBucketPublicAccess: true
      noDefaultRootObject: boolean
      oac: OAC
      redirect403ToRoot: boolean
    }
  | {
      shouldBlockBucketPublicAccess: false
      noDefaultRootObject: boolean
      oac: null
      redirect403ToRoot: boolean
    }

export const updateCloudFrontDistribution = async (
  distributionId: string,
  domainName: string,
  options: CommonUpdateCloudFrontDistributionOptions &
    SpecificUpdateCloudFrontDistributionOptions
) => {
  const {
    shouldBlockBucketPublicAccess,
    oac,
    noDefaultRootObject,
    redirect403ToRoot,
    additionalDomainNames,
    cloudFrontFunctionsAssignments,
  } = options
  try {
    let functionARN: string | undefined
    let updatedDistributionConfig: DistributionConfig

    const { DistributionConfig, ETag } = await cloudfront.getDistributionConfig(
      { Id: distributionId }
    )

    if (!DistributionConfig) {
      throw new Error(
        `[Cloudfront] No distribution config found for distribution "${distributionId}"`
      )
    }

    updatedDistributionConfig =
      clearDistributionConfigurationFunctions(DistributionConfig)
    updatedDistributionConfig = await assignFunctionsToDistribution(
      updatedDistributionConfig,
      cloudFrontFunctionsAssignments
    )

    if (noDefaultRootObject) {
      functionARN =
        await createAndPublishNoDefaultRootObjectRedirectionFunction()
      updatedDistributionConfig = {
        ...updatedDistributionConfig,
        DefaultRootObject: '',
      }
      updatedDistributionConfig = addFunctionToDistribution(
        updatedDistributionConfig,
        functionARN,
        EventType.viewer_request
      )
    } else {
      updatedDistributionConfig = {
        ...updatedDistributionConfig,
        DefaultRootObject: DEFAULT_ROOT_OBJECT,
      }
    }

    logger.info(
      `[Cloudfront] ✏️ Update distribution configuration "${distributionId}"...`
    )

    if (shouldBlockBucketPublicAccess) {
      if (!oac?.originAccessControl?.Id) {
        throw new Error(
          `[Cloudfront] No origin access control found for distribution "${distributionId}"`
        )
      }

      updatedDistributionConfig = makeBucketPrivate(
        domainName,
        updatedDistributionConfig,
        oac.originAccessControl.Id
      )
    } else {
      updatedDistributionConfig = makeBucketPublic(
        updatedDistributionConfig,
        domainName
      )
    }

    if (redirect403ToRoot) {
      updatedDistributionConfig = add403RedirectionToRoot(
        updatedDistributionConfig
      )
    }

    if (additionalDomainNames.length > 0) {
      updatedDistributionConfig = addAdditionalDomainNames(
        updatedDistributionConfig,
        additionalDomainNames
      )
    }

    const shouldUpdateDistribution = isDistributionConfigModified(
      DistributionConfig!,
      updatedDistributionConfig
    )

    if (!shouldUpdateDistribution) {
      logger.info(
        `[Cloudfront] 👍 No updates needed for distribution "${distributionId}"`
      )
      return
    }

    await cloudfront.updateDistribution({
      Id: distributionId,
      IfMatch: ETag,
      DistributionConfig: updatedDistributionConfig,
    })
  } catch (error) {
    throw error
  }
}

const isDistributionConfigModified = (
  updatedDistributionConfig: DistributionConfig,
  distributionConfig: DistributionConfig
): boolean =>
  JSON.stringify(updatedDistributionConfig) !==
  JSON.stringify(distributionConfig)

const addFunctionToDistribution = (
  distributionConfig: DistributionConfig,
  functionARN: string,
  eventType: EventType
): DistributionConfig => {
  const items =
    distributionConfig.DefaultCacheBehavior!.FunctionAssociations?.Items ?? []
  return {
    ...distributionConfig,
    DefaultCacheBehavior: {
      ...distributionConfig.DefaultCacheBehavior!,
      FunctionAssociations: {
        Quantity: items.length + 1,
        Items: [
          ...items,
          {
            FunctionARN: functionARN,
            EventType: eventType,
          },
        ],
      },
    },
  }
}

const makeBucketPrivate = (
  domainName: string,
  distributionConfig: DistributionConfig,
  originAccessControlId: string
): DistributionConfig => {
  const privateBucketDomainName = getS3DomainNameForBlockedBucket(domainName)

  const isOACAlreadyAssociated = distributionConfig?.Origins?.Items?.find(
    o => o.DomainName === privateBucketDomainName
  )

  if (isOACAlreadyAssociated) {
    logger.info(
      `[Cloudfront] 👍 OAC already associated with S3 domain "${privateBucketDomainName}"...`
    )
    return distributionConfig
  }

  logger.info(
    `[Cloudfront] ✏️ Generating new OAC association config for S3 domain "${privateBucketDomainName}"...`
  )

  return {
    ...distributionConfig,
    Origins: {
      ...distributionConfig.Origins,
      Quantity: 1,
      Items: [
        {
          Id: privateBucketDomainName,
          DomainName: privateBucketDomainName,
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
      ViewerProtocolPolicy:
        distributionConfig.DefaultCacheBehavior?.ViewerProtocolPolicy ||
        'redirect-to-https',
      TargetOriginId: privateBucketDomainName,
    },
  }
}

const makeBucketPublic = (
  distributionConfig: DistributionConfig,
  domainName: string
): DistributionConfig => {
  const isS3WebsiteAlreadyAssociated = distributionConfig?.Origins?.Items?.find(
    o => o.DomainName === getS3DomainName(domainName)
  )

  if (isS3WebsiteAlreadyAssociated) {
    logger.info(
      `[Cloudfront] 👍 S3 website already associated with distribution...`
    )
    return distributionConfig
  }

  logger.info(
    `[Cloudfront] ✏️ Generating new S3 website association config for "${domainName}"...`
  )

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
            OriginProtocolPolicy: OriginProtocolPolicy.https_only,
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
      ViewerProtocolPolicy:
        distributionConfig.DefaultCacheBehavior?.ViewerProtocolPolicy ||
        'redirect-to-https',
    },
  }
}

const addAdditionalDomainNames = (
  distributionConfig: DistributionConfig,
  domainNames: string[]
): DistributionConfig => {
  const updatedDomainNames = new Set([
    ...(distributionConfig.Aliases?.Items ?? []),
    ...domainNames,
  ])
  return {
    ...distributionConfig,
    Aliases: {
      Quantity: updatedDomainNames.size,
      Items: [...updatedDomainNames],
    },
  }
}

const add403RedirectionToRoot = (
  distributionConfig: DistributionConfig
): DistributionConfig => {
  const existingErrorResponse =
    distributionConfig.CustomErrorResponses?.Items?.some(
      item => item.ErrorCode === 403
    )

  if (existingErrorResponse) {
    logger.info(`[Cloudfront] 👍 a custom 403 error response already exists...`)
    return distributionConfig
  }

  logger.info(
    `[Cloudfront] ✏️ Adding custom 403 error response to distribution...`
  )
  return {
    ...distributionConfig,
    CustomErrorResponses: {
      Quantity: (distributionConfig.CustomErrorResponses?.Quantity || 0) + 1,
      Items: [
        ...(distributionConfig.CustomErrorResponses?.Items || []),
        {
          ErrorCode: 403,
          ResponsePagePath: '/index.html',
          ResponseCode: '200',
          ErrorCachingMinTTL: 10,
        },
      ],
    },
  }
}
