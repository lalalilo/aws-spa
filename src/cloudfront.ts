import { cloudfront, bucketRegion, websiteEndpoint } from "./aws-services";
import { getAll } from "./aws-helper";
import { logger } from "./logger";
import {
  DistributionSummary,
  DistributionConfig,
  Tag
} from "aws-sdk/clients/cloudfront";

export const findCloudfrontDistribution = async (
  originBucketName: string,
  wait: boolean = false
) => {
  const distributions = await getAll<DistributionSummary>(
    async (nextMarker, page) => {
      logger.info(
        `[CloudFront] searching cloudfront distribution (page ${page})...`
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

  for (const distribution of distributions) {
    if (
      !distribution.Origins.Items[0] ||
      distribution.Origins.Items[0].Id !== getOriginId(originBucketName)
    ) {
      continue;
    }

    logger.info(`[CloudFront] Distribution found: ${distribution.Id}`);

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
        `[CloudFront] Distribution "${
          distribution.Id
        }" does not seem to have been created by aws-spa. You should delete it...`
      );
    }
    if (wait && distribution.Status === "In Progress") {
      await cloudfront
        .waitFor("distributionDeployed", { Id: distribution.Id })
        .promise();
    }
    return distribution;
  }

  return null;
};

export const createCloudFrontDistribution = async (
  domainName: string,
  sslCertificateARN: string,
  wait: boolean = false
) => {
  const distributionConfig = getDistributionConfig(
    domainName,
    sslCertificateARN
  );

  logger.info(
    `[CloudFront] Creating Cloudfront distribution with origin "${getS3DomainName(
      domainName
    )}"...`
  );
  const { Distribution } = await cloudfront
    .createDistributionWithTags({
      DistributionConfigWithTags: {
        DistributionConfig: distributionConfig,
        Tags: {
          Items: [identifyingTag]
        }
      }
    })
    .promise();

  if (!Distribution) {
    throw new Error("[CloudFront] Could not create distribution");
  }

  if (wait) {
    logger.info(
      `[CloudFront] Waiting for distribution to be available. This step might takes up to 25 minutes...`
    );
    await cloudfront
      .waitFor("distributionDeployed", { Id: Distribution.Id })
      .promise();
  }
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
  logger.info("[CloudFront] Creating invalidation...");
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
      "[CloudFront] Waiting for invalidation to be completed (can take up to 10 minutes)..."
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
  Key: "created-by",
  Value: "aws-spa"
};
