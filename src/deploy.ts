import { existsSync } from "fs";
import { createCertificate, getCertificateARN } from "./acm";
import {
  DistributionIdentificationDetail,
  createCloudFrontDistribution,
  findDeployedCloudfrontDistribution,
  getCacheInvalidations,
  invalidateCloudfrontCacheWithRetry,
  setSimpleAuthBehavior,
  updateCloudFrontDistribution,
} from "./cloudfront";
import {
  cleanExistingOriginAccessControl,
  upsertOriginAccessControl,
} from "./cloudfront/origin-access";
import { deploySimpleAuthLambda } from "./lambda";
import { logger } from "./logger";
import { predeployPrompt } from "./prompt";
import {
  createHostedZone,
  findHostedZone,
  needsUpdateRecord,
  updateRecord,
} from "./route53";

import {
  allowBucketPublicAccess,
  blockBucketPublicAccess,
  confirmBucketManagement,
  createBucket,
  doesS3BucketExists,
  removeBucketWebsite,
  setBucketPolicy,
  setBucketPolicyForOAC,
  setBucketWebsite,
  syncToS3,
  tagBucket,
} from "./s3";

export const deploy = async (
  url: string,
  folder: string,
  wait: boolean,
  cacheInvalidations: string,
  cacheBustedPrefix: string | undefined,
  credentials: string | undefined,
  noPrompt: boolean,
  shouldBlockBucketPublicAccess: boolean,
  noDefaultRootObject: boolean
) => {
  await predeployPrompt(Boolean(process.env.CI), noPrompt);

  const [domainName, s3Folder] = url.split("/");

  logger.info(
    `✨ Deploying "${folder}" on "${domainName}" with path "${
      s3Folder || "/"
    }"...`
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
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await tagBucket(domainName);

  let hostedZone = await findHostedZone(domainName);
  if (!hostedZone) {
    hostedZone = await createHostedZone(domainName);
  }

  let certificateArn = await getCertificateARN(domainName);
  if (!certificateArn) {
    certificateArn = await createCertificate(domainName, hostedZone.Id);
  }

  let distribution: DistributionIdentificationDetail | null =
    await findDeployedCloudfrontDistribution(domainName);
  if (!distribution) {
    distribution = await createCloudFrontDistribution(
      domainName,
      certificateArn,
      noDefaultRootObject
    );
  }

  if (shouldBlockBucketPublicAccess) {
    const oac = await upsertOriginAccessControl(domainName, distribution.Id);
    await updateCloudFrontDistribution(distribution.Id, domainName, {
      shouldBlockBucketPublicAccess: true,
      noDefaultRootObject,
      oac,
    });
    await removeBucketWebsite(domainName);
    await blockBucketPublicAccess(domainName);
    await setBucketPolicyForOAC(domainName, distribution.Id);
  } else {
    await updateCloudFrontDistribution(distribution.Id, domainName, {
      shouldBlockBucketPublicAccess: false,
      noDefaultRootObject,
      oac: null,
    });
    await setBucketWebsite(domainName);
    await allowBucketPublicAccess(domainName);
    await setBucketPolicy(domainName);
    await cleanExistingOriginAccessControl(domainName, distribution.Id);
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

  await invalidateCloudfrontCacheWithRetry(
    distribution.Id,
    getCacheInvalidations(cacheInvalidations, s3Folder),
    wait
  );
};
