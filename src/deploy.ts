import { existsSync } from "fs";
import {
  doesS3BucketExists,
  createBucket,
  syncToS3,
  setBucketWebsite,
  setBucketPolicy
} from "./s3";
import { getCertificateARN, createCertificate } from "./acm";
import {
  findCloudfrontDistribution,
  createCloudFrontDistribution,
  invalidateCloudfrontCache
} from "./cloudfront";
import { findHostedZone, createHostedZone, updateRecord } from "./route53";
import { logger } from "./logger";

interface DistributionInfo {
  Id: string;
  DomainName: string;
}

export const deploy = async (
  domainName: string,
  folder: string,
  wait: boolean
) => {
  logger.info(`Deploying "${folder}" on "${domainName}"...`);

  if (!existsSync(folder)) {
    throw new Error(`folder "${folder}" not found`);
  }
  if (!existsSync(`${folder}/index.html`)) {
    throw new Error(`folder "index.html" not found in "${folder}" folder`);
  }

  if (!(await doesS3BucketExists(domainName))) {
    await createBucket(domainName);
  }
  await setBucketWebsite(domainName);
  await setBucketPolicy(domainName);

  let certificateArn = await getCertificateARN(domainName);
  if (!certificateArn) {
    certificateArn = await createCertificate(domainName);
  }

  let distribution: DistributionInfo | null = await findCloudfrontDistribution(
    domainName,
    wait
  );
  if (!distribution) {
    distribution = await createCloudFrontDistribution(
      domainName,
      certificateArn,
      wait
    );
  }

  let hostedZone = await findHostedZone(domainName);
  if (!hostedZone) {
    hostedZone = await createHostedZone(domainName);
  }
  await updateRecord(hostedZone.Id, domainName, distribution.DomainName);

  await syncToS3(folder, domainName);
  await invalidateCloudfrontCache(distribution.Id, wait);
};
