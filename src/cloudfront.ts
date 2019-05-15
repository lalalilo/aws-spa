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

  const distribution = distributions.find(_distribution =>
    Boolean(
      _distribution.Aliases.Items &&
        _distribution.Aliases.Items.includes(domainName)
    )
  );

  if (!distribution) {
    logger.info(`[CloudFront] 😬 No matching distribution`);
    return null;
  }

  logger.info(`[CloudFront] 👍 Distribution found: ${distribution.Id}`);

  if (distribution.Status === "In Progress") {
    logger.info(
      `[CloudFront] ⏱ Waiting for distribution to be deployed. This step might takes up to 25 minutes...`
    );
    await cloudfront
      .waitFor("distributionDeployed", { Id: distribution.Id })
      .promise();
  }
  return distribution;
};

export const confirmDistributionManagement = async (
  distribution: DistributionIdentificationDetail
) => {
  logger.info(
    `[CloudFront] 🔍 Checking that tag "${identifyingTag.Key}:${
      identifyingTag.Value
    }" exists on distribution "${distribution.Id}"...`
  );

  const { Tags } = await cloudfront
    .listTagsForResource({ Resource: distribution.ARN })
    .promise();

  if (
    Tags &&
    Tags.Items &&
    Tags.Items.find(
      tag =>
        tag.Key === identifyingTag.Key && tag.Value === identifyingTag.Value
    )
  ) {
    return true;
  }

  const { continueUpdate } = await prompt([
    {
      type: "confirm",
      name: "continueUpdate",
      message: `[CloudFront] Distribution "${
        distribution.Id
      }" is not yet managed by aws-spa. Would you like it to be managed by aws-spa?`,
      default: false
    }
  ]);

  if (continueUpdate) {
    return true;
  }

  throw new Error(
    "You can use another domain name or delete the distribution..."
  );
};

export const updateCloudFrontDistribution = async (
  originBucketName: string,
  sslCertificateARN: string,
  distribution: DistributionIdentificationDetail
) => {
  logger.info(
    `[CloudFront] ✏️ Updating "${distribution.Id}" distribution config...`
  );
  await cloudfront
    .updateDistribution({
      DistributionConfig: getDistributionConfig(
        originBucketName,
        sslCertificateARN
      ),
      Id: distribution.Id
    })
    .promise();
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
          OriginProtocolPolicy: "http-only"
        }
      }
    ]
  },
  Enabled: true,
  Comment: "",
  DefaultCacheBehavior: {
    ViewerProtocolPolicy: "redirect-to-https",
    TargetOriginId: getOriginId(domainName),
    ForwardedValues: {
      QueryString: false,
      Cookies: {
        Forward: "none"
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
