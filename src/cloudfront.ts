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
      console.log(`cloudfront distribution found: ${distribution.Id}`);
      return distribution;
    }
  }
};

const getOriginId = (domainName: string) =>
  `S3-Website-${domainName}.${websiteEndpoint[bucketRegion]}`;
