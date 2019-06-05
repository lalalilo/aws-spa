import { prompt } from "inquirer";
import { cloudfront, bucketRegion, websiteEndpoint } from "./aws-services";
import { getAll } from "./aws-helper";
import { logger } from "./logger";
import {
  DistributionSummary,
  DistributionConfig,
  Tag
} from "aws-sdk/clients/cloudfront";

export interface DistributionIdentificationDetail {
  Id: string;
  ARN: string;
  DomainName: string;
}

export const findDeployedCloudfrontDistribution = async (
  domainName: string
) => {
  const distributions = await getAll<DistributionSummary>(
    async (nextMarker, page) => {
      logger.info(
        `[CloudFront] 🔍 searching cloudfront distribution (page ${page})...`
      );

      const { DistributionList } = await cloudfront
        .listDistributions({
          Marker: nextMarker
        })
        .promise();

      if (!DistributionList) {
        return { items: [], nextMarker: undefined };
      }

      return {
        items: DistributionList.Items || [],
        nextMarker: DistributionList.NextMarker
      };
    }
  );

  const distribution = distributions.find(
    _distribution =>
      _distribution.Origins.Items[0] &&
      _distribution.Origins.Items[0].Id === getOriginId(domainName)
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
      tag =>
        tag.Key === identifyingTag.Key && tag.Value === identifyingTag.Value
    )
  ) {
    throw new Error(
      `CloudFront distribution ${distribution.Id} has no tag ${
        identifyingTag.Key
      }:${identifyingTag.Value}`
    );
  }

  logger.info(`[CloudFront] 👍 Distribution found: ${distribution.Id}`);

  if (["InProgress", "In Progress"].includes(distribution.Status)) {
    logger.info(
      `[CloudFront] ⏱ Waiting for distribution to be deployed. This step might takes up to 25 minutes...`
    );
    await cloudfront
      .waitFor("distributionDeployed", { Id: distribution.Id })
      .promise();
  }
  return distribution;
};

export const tagCloudFrontDistribution = async (
  distribution: DistributionIdentificationDetail
) => {
  logger.info(
    `[CloudFront] ✏️ Tagging "${distribution.Id}" bucket with "${
      identifyingTag.Key
    }:${identifyingTag.Value}"...`
  );
  await cloudfront
    .tagResource({
      Resource: distribution.ARN,
      Tags: {
        Items: [identifyingTag]
      }
    })
    .promise();
};

export const createCloudFrontDistribution = async (
  domainName: string,
  sslCertificateARN: string
): Promise<DistributionIdentificationDetail> => {
  logger.info(
    `[CloudFront] ✏️ Creating Cloudfront distribution with origin "${getS3DomainName(
      domainName
    )}"...`
  );

  const { Distribution } = await cloudfront
    .createDistribution({
      DistributionConfig: getDistributionConfig(domainName, sslCertificateARN)
    })
    .promise();

  if (!Distribution) {
    throw new Error("[CloudFront] Could not create distribution");
  }

  await tagCloudFrontDistribution(Distribution);

  logger.info(
    `[CloudFront] ⏱ Waiting for distribution to be available. This step might takes up to 25 minutes...`
  );
  await cloudfront
    .waitFor("distributionDeployed", { Id: Distribution.Id })
    .promise();
  return Distribution;
};

const getDistributionConfig = (
  domainName: string,
  sslCertificateARN: string
): DistributionConfig => ({
  CallerReference: Date.now().toString(),
  Aliases: {
    Quantity: 1,
    Items: [domainName]
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
            Items: ["TLSv1"]
          },
          OriginReadTimeout: 30,
          OriginKeepaliveTimeout: 5
        },
        CustomHeaders: {
          Quantity: 0,
          Items: []
        },
        OriginPath: ""
      }
    ]
  },
  Enabled: true,
  Comment: "",
  PriceClass: "PriceClass_All",
  Logging: {
    Enabled: false,
    IncludeCookies: false,
    Bucket: "",
    Prefix: ""
  },
  CacheBehaviors: {
    Quantity: 0
  },
  CustomErrorResponses: {
    Quantity: 0
  },
  Restrictions: {
    GeoRestriction: {
      RestrictionType: "none",
      Quantity: 0
    }
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
        Forward: "none"
      },
      Headers: {
        Quantity: 0,
        Items: []
      },
      QueryStringCacheKeys: {
        Quantity: 0,
        Items: []
      }
    },
    AllowedMethods: {
      Quantity: 2,
      Items: ["HEAD", "GET"],
      CachedMethods: {
        Quantity: 2,
        Items: ["HEAD", "GET"]
      }
    },
    TrustedSigners: {
      Enabled: false,
      Quantity: 0
    },
    MinTTL: 0,
    DefaultTTL: 86400,
    MaxTTL: 31536000,
    FieldLevelEncryptionId: "",
    LambdaFunctionAssociations: {
      Quantity: 0,
      Items: []
    },
    SmoothStreaming: false,
    Compress: true // this is required to deliver gzip data
  },
  ViewerCertificate: {
    ACMCertificateArn: sslCertificateARN,
    SSLSupportMethod: "sni-only",
    MinimumProtocolVersion: "TLSv1.1_2016",
    CertificateSource: "acm"
  }
});

const getS3DomainName = (domainName: string) =>
  `${domainName}.${websiteEndpoint[bucketRegion]}`;

const getOriginId = (domainName: string) =>
  `S3-Website-${getS3DomainName(domainName)}`;

export const invalidateCloudfrontCache = async (
  distributionId: string,
  wait: boolean = false
) => {
  logger.info("[CloudFront] ✏️ Creating invalidation...");
  const { Invalidation } = await cloudfront
    .createInvalidation({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: {
          Quantity: 1,
          Items: ["/index.html"]
        }
      }
    })
    .promise();

  if (!Invalidation) {
    return;
  }

  if (wait) {
    logger.info(
      "[CloudFront] ⏱ Waiting for invalidation to be completed (can take up to 10 minutes)..."
    );
    await cloudfront
      .waitFor("invalidationCompleted", {
        DistributionId: distributionId,
        Id: Invalidation.Id
      })
      .promise();
  }
};

export const identifyingTag: Tag = {
  Key: "managed-by-aws-spa",
  Value: "v1"
};
