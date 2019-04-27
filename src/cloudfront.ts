import { cloudfront, bucketRegion, websiteEndpoint } from "./aws-services";
import { getAll } from "./aws-helper";
import { logger } from "./logger";
import { DistributionSummary } from "aws-sdk/clients/cloudfront";

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
      distribution.Origins.Items[0] &&
      distribution.Origins.Items[0].Id === getOriginId(originBucketName)
    ) {
      logger.info(`cloudfront distribution found: ${distribution.Id}`);
      return distribution;
    }
  }
};

const getOriginId = (domainName: string) =>
  `S3-Website-${domainName}.${websiteEndpoint[bucketRegion]}`;

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
