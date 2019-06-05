import { existsSync } from "fs";
import {
  doesS3BucketExists,
  createBucket,
  syncToS3,
  setBucketWebsite,
  setBucketPolicy,
  confirmBucketManagement,
  tagBucket
} from "./s3";
import { getCertificateARN, createCertificate } from "./acm";
import {
  findDeployedCloudfrontDistribution,
  createCloudFrontDistribution,
  invalidateCloudfrontCache,
  DistributionIdentificationDetail
} from "./cloudfront";
import {
  findHostedZone,
  createHostedZone,
  updateRecord,
  confirmUpdateRecord
} from "./route53";
import { logger } from "./logger";

export const deploy = async (
  domainName: string,
  folder: string,
  wait: boolean
) => {
  logger.info(`✨ Deploying "${folder}" on "${domainName}"...`);

  if (!existsSync(folder)) {
    throw new Error(`folder "${folder}" not found`);
  }
  if (!existsSync(`${folder}/index.html`)) {
    throw new Error(`"index.html" not found in "${folder}" folder`);
  }
  if (!existsSync(`${folder}/static`)) {
    logger.warn(
      `folder "${folder}/static" does not exists. Only files in this folder are assumed to have a hash as explained in https://facebook.github.io/create-react-app/docs/production-build#static-file-caching and will be aggressively cached`
    );
  }

  if (await doesS3BucketExists(domainName)) {
    await confirmBucketManagement(domainName);
  } else {
    await createBucket(domainName);
  }
  await tagBucket(domainName);
  await setBucketWebsite(domainName);
  await setBucketPolicy(domainName);

  let certificateArn = await getCertificateARN(domainName);
  if (!certificateArn) {
    certificateArn = await createCertificate(domainName);
  }

  let distribution: DistributionIdentificationDetail | null = await findDeployedCloudfrontDistribution(
    domainName
  );
  if (!distribution) {
    distribution = await createCloudFrontDistribution(
      domainName,
      certificateArn
    );
  }

  let hostedZone = await findHostedZone(domainName);
  if (!hostedZone) {
    hostedZone = await createHostedZone(domainName);
  }
  if (
    await confirmUpdateRecord(
      hostedZone.Id,
      domainName,
      distribution.DomainName
    )
  ) {
    await updateRecord(hostedZone.Id, domainName, distribution.DomainName);
  }

  await syncToS3(folder, domainName);
  await invalidateCloudfrontCache(distribution.Id, wait);
};
