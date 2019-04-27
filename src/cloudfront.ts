import { cloudfront, bucketRegion, websiteEndpoint } from "./aws-services";
import { getAll } from "./aws-helper";
import { logger } from "./logger";
import {
  DistributionSummary,
  DistributionConfig,
  Tag
} from "aws-sdk/clients/cloudfront";

export const findCloudfrontDistribution = async (originBucketName: string) => {
  const distributions = await getAll<DistributionSummary>(
    async (nextMarker, page) => {
      logger.info(`searching cloudfront distribution (page ${page})...`);

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

    logger.info(`cloudfront distribution found: ${distribution.Id}`);

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
        `Distribution "${
          distribution.Id
        }" does not seem to have been created by aws-spa. You should delete it...`
      );
    }
    if (distribution.Status === "In Progress") {
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
  sslCertificateARN: string
) => {
  const distributionConfig = getDistributionConfig(
    domainName,
    sslCertificateARN
  );

  logger.info(
    `[CloudFront] Creating Cloudfront distribution with bucket website origin...`
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
    throw new Error("Could not create cloudfront distribution");
  }

  // logger.info(
  //   `[CloudFront] Waiting for distribution to be available. This step might takes up to 25 minutes...`
  // );
  // await cloudfront
  //   .waitFor("distributionDeployed", { Id: Distribution.Id })
  //   .promise();
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

export const clearCloudfrontCache = async (distributionId: string) => {
  logger.info("Creating CloudFront invalidation...");
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

  // cloudfront.waitFor('invalidationCompleted', {
  //   DistributionId: distributionId,
  //   Id: Invalidation.Id
  // });
};

export const identifyingTag: Tag = {
  Key: "created-by",
  Value: "aws-spa"
};
