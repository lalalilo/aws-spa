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
  DistributionIdentificationDetail,
  setSimpleAuthBehavior,
  getCacheInvalidations
} from "./cloudfront";
import {
  findHostedZone,
  createHostedZone,
  updateRecord,
  needsUpdateRecord
} from "./route53";
import { logger } from "./logger";
import { deploySimpleAuthLambda } from "./lambda";
import { predeployPrompt } from "./prompt";

export const deploy = async (
  url: string,
  folder: string,
  wait: boolean,
  cacheInvalidations: string,
  cacheBustedPrefix: string | undefined,
  credentials: string | undefined,
  noPrompt: boolean
) => {
  await predeployPrompt(Boolean(process.env.CI), noPrompt);

  const [domainName, s3Folder] = url.split("/");

  logger.info(
    `✨ Deploying "${folder}" on "${domainName}" with path "${s3Folder ||
      "/"}"...`
  );

  if (!existsSync(folder)) {
    throw new Error(`folder "${folder}" not found`);
  }
  if (!existsSync(`${folder}/index.html`)) {
    throw new Error(`"index.html" not found in "${folder}" folder`);
  }

  if (await doesS3BucketExists(domainName)) {
    await confirmBucketManagement(domainName);
  } else {
    await createBucket(domainName);

    // without this timeout `setBucketPolicy` fails with error
    // "The specified bucket does not exist"
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  await tagBucket(domainName);
  await setBucketWebsite(domainName);
  await setBucketPolicy(domainName);

  let hostedZone = await findHostedZone(domainName);
  if (!hostedZone) {
    hostedZone = await createHostedZone(domainName);
  }

  let certificateArn = await getCertificateARN(domainName);
  if (!certificateArn) {
    certificateArn = await createCertificate(domainName, hostedZone.Id);
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

  if (credentials) {
    const simpleAuthLambdaARN = await deploySimpleAuthLambda(
      domainName,
      credentials
    );
    await setSimpleAuthBehavior(distribution.Id, simpleAuthLambdaARN);
  } else {
    await setSimpleAuthBehavior(distribution.Id, null);
  }

  if (
    await needsUpdateRecord(hostedZone.Id, domainName, distribution.DomainName)
  ) {
    await updateRecord(hostedZone.Id, domainName, distribution.DomainName);
  }

  await syncToS3(folder, domainName, cacheBustedPrefix, s3Folder);
  await invalidateCloudfrontCache(
    distribution.Id,
    getCacheInvalidations(cacheInvalidations, s3Folder),
    wait
  );
};
