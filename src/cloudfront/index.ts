import { AWSError } from "aws-sdk";
import CloudFront, {
  DistributionConfig,
  DistributionSummary,
  LambdaFunctionAssociationList,
  Tag,
} from "aws-sdk/clients/cloudfront";
import { PromiseResult } from "aws-sdk/lib/request";
import { getAll } from "../aws-helper";
import {
  cloudfront,
  getOriginId,
  getS3DomainName,
  getS3DomainNameForBlockedBucket,
} from "../aws-services";
import { lambdaPrefix } from "../lambda";
import { logger } from "../logger";
import { OAC, isRightOriginAlreadyAssociated } from "./origin-access";

export interface DistributionIdentificationDetail {
  Id: string;
  ARN: string;
  DomainName: string;
}

export const findDeployedCloudfrontDistribution = async (
  domainName: string,
) => {
  const distributions = await getAll<DistributionSummary>(
    async (nextMarker, page) => {
      logger.info(
        `[CloudFront] 🔍 Searching cloudfront distribution (page ${page})...`,
      );

      const { DistributionList } = await cloudfront
        .listDistributions({
          Marker: nextMarker,
        })
        .promise();

      if (!DistributionList) {
        return { items: [], nextMarker: undefined };
      }

      return {
        items: DistributionList.Items || [],
        nextMarker: DistributionList.NextMarker,
      };
    },
  );

  const distribution = distributions.find((_distribution) =>
    Boolean(
      _distribution.Aliases.Items &&
        _distribution.Aliases.Items.includes(domainName),
    ),
  );

  if (!distribution) {
    logger.info(`[CloudFront] 😬 No matching distribution`);
    return null;
  }

  const { Tags } = await cloudfront
    .listTagsForResource({ Resource: distribution.ARN })
    .promise();
  if (
    !Tags ||
    !Tags.Items ||
    !Tags.Items.find(
      (tag) =>
        tag.Key === identifyingTag.Key && tag.Value === identifyingTag.Value,
    )
  ) {
    throw new Error(
      `CloudFront distribution ${distribution.Id} has no tag ${identifyingTag.Key}:${identifyingTag.Value}`,
    );
  }

  logger.info(`[CloudFront] 👍 Distribution found: ${distribution.Id}`);

  if (["InProgress", "In Progress"].includes(distribution.Status)) {
    logger.info(
      `[CloudFront] ⏱ Waiting for distribution to be deployed. This step might takes up to 25 minutes...`,
    );
    await cloudfront
      .waitFor("distributionDeployed", { Id: distribution.Id })
      .promise();
  }
  return distribution;
};

export const tagCloudFrontDistribution = async (
  distribution: DistributionIdentificationDetail,
) => {
  logger.info(
    `[CloudFront] ✏️ Tagging "${distribution.Id}" bucket with "${identifyingTag.Key}:${identifyingTag.Value}"...`,
  );
  await cloudfront
    .tagResource({
      Resource: distribution.ARN,
      Tags: {
        Items: [identifyingTag],
      },
    })
    .promise();
};

export const createCloudFrontDistribution = async (
  domainName: string,
  sslCertificateARN: string,
): Promise<DistributionIdentificationDetail> => {
  logger.info(
    `[CloudFront] ✏️ Creating Cloudfront distribution with origin "${getS3DomainName(
      domainName,
    )}"...`,
  );

  const { Distribution } = await cloudfront
    .createDistribution({
      DistributionConfig: getBaseDistributionConfig(
        domainName,
        sslCertificateARN,
      ),
    })
    .promise();

  if (!Distribution) {
    throw new Error("[CloudFront] Could not create distribution");
  }

  await tagCloudFrontDistribution(Distribution);

  logger.info(
    `[CloudFront] ⏱ Waiting for distribution to be available. This step might takes up to 25 minutes...`,
  );
  await cloudfront
    .waitFor("distributionDeployed", { Id: Distribution.Id })
    .promise();
  return Distribution;
};

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
          OriginProtocolPolicy: "http-only",
          OriginSslProtocols: {
            Quantity: 1,
            Items: ["TLSv1"],
          },
          OriginReadTimeout: 30,
          OriginKeepaliveTimeout: 5,
        },
        CustomHeaders: {
          Quantity: 0,
          Items: [],
        },
        OriginPath: "",
      },
    ],
  },
  Enabled: true,
  Comment: "",
  PriceClass: "PriceClass_All",
  Logging: {
    Enabled: false,
    IncludeCookies: false,
    Bucket: "",
    Prefix: "",
  },
  CacheBehaviors: {
    Quantity: 0,
  },
  CustomErrorResponses: {
    Quantity: 0,
  },
  Restrictions: {
    GeoRestriction: {
      RestrictionType: "none",
      Quantity: 0,
    },
  },
  DefaultRootObject: "index.html",
  WebACLId: "",
  HttpVersion: "http2",
  DefaultCacheBehavior: {
    ViewerProtocolPolicy: "redirect-to-https",
    TargetOriginId: getOriginId(domainName),
    ForwardedValues: {
      QueryString: false,
      Cookies: {
        Forward: "none",
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
      Items: ["HEAD", "GET"],
      CachedMethods: {
        Quantity: 2,
        Items: ["HEAD", "GET"],
      },
    },
    TrustedSigners: {
      Enabled: false,
      Quantity: 0,
    },
    MinTTL: 0,
    DefaultTTL: 86400,
    MaxTTL: 31536000,
    FieldLevelEncryptionId: "",
    LambdaFunctionAssociations: {
      Quantity: 0,
      Items: [],
    },
    SmoothStreaming: false,
    Compress: true, // this is required to deliver gzip data
  },
  ViewerCertificate: {
    ACMCertificateArn: sslCertificateARN,
    SSLSupportMethod: "sni-only",
    MinimumProtocolVersion: "TLSv1.1_2016",
    CertificateSource: "acm",
  },
});

export const invalidateCloudfrontCache = async (
  distributionId: string,
  paths: string,
  wait: boolean = false,
) => {
  logger.info("[CloudFront] ✏️ Creating invalidation...");
  const { Invalidation } = await cloudfront
    .createInvalidation({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: {
          Quantity: paths.split(",").length,
          Items: paths.split(",").map((path) => path.trim()),
        },
      },
    })
    .promise();

  if (!Invalidation) {
    return;
  }

  if (wait) {
    logger.info(
      "[CloudFront] ⏱ Waiting for invalidation to be completed (can take up to 10 minutes)...",
    );
    await cloudfront
      .waitFor("invalidationCompleted", {
        DistributionId: distributionId,
        Id: Invalidation.Id,
      })
      .promise();
  }
};

export const invalidateCloudfrontCacheWithRetry = async (
  distributionId: string,
  paths: string,
  wait: boolean = false,
  count: number = 0,
): Promise<PromiseResult<
  CloudFront.GetInvalidationResult,
  AWSError
> | void> => {
  try {
    return await invalidateCloudfrontCache(distributionId, paths, wait);
  } catch (error) {
    if (count < 4) {
      return await invalidateCloudfrontCacheWithRetry(
        distributionId,
        paths,
        wait,
        count + 1,
      );
    }
    throw error;
  }
};

export const identifyingTag: Tag = {
  Key: "managed-by-aws-spa",
  Value: "v1",
};

export const setSimpleAuthBehavior = async (
  distributionId: string,
  lambdaFunctionARN: string | null,
) => {
  const { DistributionConfig, ETag } = await cloudfront
    .getDistributionConfig({ Id: distributionId })
    .promise();

  const lambdaConfigs =
    DistributionConfig!.DefaultCacheBehavior.LambdaFunctionAssociations!.Items!;

  if (lambdaFunctionARN === null) {
    logger.info(
      `[CloudFront] 📚 No basic auth configured. Checking if there is a basic auth to remove...`,
    );
    const updatedLambdaFunctions = lambdaConfigs.filter(
      (config) => !config.LambdaFunctionARN.includes(lambdaPrefix),
    );

    if (updatedLambdaFunctions.length !== lambdaConfigs.length) {
      logger.info(
        `[CloudFront] 🗑 Removing lambda function association handling basic auth...`,
      );

      await updateLambdaFunctionAssociations(
        distributionId,
        DistributionConfig!,
        updatedLambdaFunctions,
        ETag!,
      );
      logger.info(`[CloudFront] 👍 Lambda function association removed`);
    } else {
      logger.info(`[CloudFront] 👍 No basic auth setup`);
    }
    return;
  }

  logger.info(`[CloudFront] 📚 Checking if basic auth is already setup...`);
  console.log(lambdaConfigs, lambdaFunctionARN);
  if (
    lambdaConfigs.find(
      (config) => config.LambdaFunctionARN === lambdaFunctionARN,
    )
  ) {
    logger.info(`[CloudFront] 👍 Basic auth already setup`);
    return;
  }

  logger.info(
    `[CloudFront] ✏️ Adding simple auth behavior (and replacing "viewer-request" lambda if any)...`,
  );
  await updateLambdaFunctionAssociations(
    distributionId,
    DistributionConfig!,
    [
      ...lambdaConfigs.filter(
        (config) => config.EventType !== "viewer-request",
      ),
      {
        LambdaFunctionARN: lambdaFunctionARN,
        EventType: "viewer-request",
        IncludeBody: false,
      },
    ],
    ETag!,
  );
};

export const getCacheInvalidations = (
  cacheInvalidations: string,
  subFolder: string | undefined,
) =>
  cacheInvalidations
    .split(",")
    .map((string) => string.trim().replace(/^\//, ""))
    .map((string) => (subFolder ? `/${subFolder}/${string}` : `/${string}`))
    .join(",");

const updateLambdaFunctionAssociations = async (
  distributionId: string,
  DistributionConfig: DistributionConfig,
  lambdaConfigs: LambdaFunctionAssociationList,
  ETag: string,
) => {
  await cloudfront
    .updateDistribution({
      Id: distributionId,
      IfMatch: ETag,
      DistributionConfig: {
        ...DistributionConfig,
        DefaultCacheBehavior: {
          ...DistributionConfig.DefaultCacheBehavior,
          LambdaFunctionAssociations: {
            Quantity: lambdaConfigs.length,
            Items: lambdaConfigs,
          },
        },
      },
    })
    .promise();
};

export const updateCloudFrontDistribution = async (
  distributionId: string,
  domainName: string,
  options: {
    shouldBlockBucketPublicAccess: boolean;
    oac: OAC | null;
  },
) => {
  const { shouldBlockBucketPublicAccess, oac } = options;
  try {
    const { DistributionConfig, ETag } = await cloudfront
      .getDistributionConfig({ Id: distributionId })
      .promise();

    if (
      isRightOriginAlreadyAssociated(
        shouldBlockBucketPublicAccess,
        domainName,
        DistributionConfig,
      )
    ) {
      return;
    }

    logger.info(
      `[Cloudfront] ✏️ Update distribution configuration "${distributionId}"...`,
    );

    await cloudfront
      .updateDistribution({
        Id: distributionId,
        IfMatch: ETag,
        DistributionConfig: getUpdatedDistributionConfig(
          domainName,
          oac?.originAccessControl.Id,
          DistributionConfig!,
          shouldBlockBucketPublicAccess,
        ),
      })
      .promise();
  } catch (error) {
    throw error;
  }
};

const getUpdatedDistributionConfig = (
  domainName: string,
  originAccessControlId: string | undefined,
  distributionConfig: CloudFront.DistributionConfig,
  shouldBlockBucketPublicAccess: boolean,
) => {
  if (shouldBlockBucketPublicAccess && originAccessControlId) {
    return {
      ...distributionConfig!,
      Origins: {
        Quantity: 1,
        Items: [
          {
            Id: getS3DomainNameForBlockedBucket(domainName),
            DomainName: getS3DomainNameForBlockedBucket(domainName),
            OriginAccessControlId: originAccessControlId,
            S3OriginConfig: {
              OriginAccessIdentity: "", //If you're using origin access control (OAC) instead of origin access identity, specify an empty OriginAccessIdentity element
            },
            OriginPath: "",
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
    };
  }
  return {
    ...distributionConfig,
    Origins: {
      Quantity: 1,
      Items: [
        {
          Id: getOriginId(domainName),
          DomainName: getS3DomainName(domainName),
          CustomOriginConfig: {
            HTTPPort: 80,
            HTTPSPort: 443,
            OriginProtocolPolicy: "http-only",
            OriginSslProtocols: {
              Quantity: 1,
              Items: ["TLSv1"],
            },
            OriginReadTimeout: 30,
            OriginKeepaliveTimeout: 5,
          },
          CustomHeaders: {
            Quantity: 0,
            Items: [],
          },
          OriginPath: "",
        },
      ],
    },
    DefaultCacheBehavior: {
      ...distributionConfig.DefaultCacheBehavior,
      TargetOriginId: getOriginId(domainName),
    },
  };
};
