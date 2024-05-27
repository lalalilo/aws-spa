import { CloudFront } from "aws-sdk";
import {
  cloudfront,
  getS3DomainName,
  getS3DomainNameForBlockedBucket,
} from "../aws-services";
import { logger } from "../logger";

export type OAC = {
  originAccessControl: CloudFront.OriginAccessControl;
  ETag: string;
};

export const getExistingOAC = async (originAccessControlName: String) => {
  const { OriginAccessControlList } = await cloudfront
    .listOriginAccessControls()
    .promise();

  const existingOACSummary = OriginAccessControlList?.Items?.find(
    (oac) => oac.Name === originAccessControlName,
  );

  if (!existingOACSummary) {
    return null;
  }
  const oac = await cloudfront
    .getOriginAccessControl({ Id: existingOACSummary.Id! })
    .promise();
  return { originAccessControl: oac.OriginAccessControl!, ETag: oac.ETag! };
};

export const createOAC = async (
  originAccessControlName: string,
  domainName: string,
  distributionId: string,
) => {
  try {
    logger.info(
      `[Cloudfront] ✏️ Creating an Origin Access Control for "${domainName}"...`,
    );
    const oac = await cloudfront
      .createOriginAccessControl({
        OriginAccessControlConfig: {
          Name: originAccessControlName,
          OriginAccessControlOriginType: "s3",
          SigningBehavior: "always",
          SigningProtocol: "sigv4",
          Description: `OAC used by ${domainName} associated to distributionId: ${distributionId}`,
        },
      })
      .promise();
    return { originAccessControl: oac.OriginAccessControl!, ETag: oac.ETag! };
  } catch (error) {
    throw error;
  }
};

export const getOriginAccessControlName = (
  domainName: string,
  distributionId: string,
) => `${domainName}-${distributionId}`;

export const upsertOriginAccessControl = async (
  domainName: string,
  distributionId: string,
  shouldBlockBucketPublicAccess: boolean,
) => {
  const originAccessControlName = getOriginAccessControlName(
    domainName,
    distributionId,
  );
  const existingOAC = await getExistingOAC(originAccessControlName);
  if (existingOAC !== null) {
    return existingOAC;
  }

  if (shouldBlockBucketPublicAccess) {
    return await createOAC(originAccessControlName, domainName, distributionId);
  }
};

export const deleteOriginAccessControl = async (oac: OAC) => {
  await cloudfront
    .deleteOriginAccessControl({
      Id: oac.originAccessControl.Id,
      IfMatch: oac.ETag,
    })
    .promise();
  return;
};

export const isRightOriginAlreadyAssociated = (
  shouldBlockBucketPublicAccess: boolean,
  domainName: string,
  distributionConfig: CloudFront.DistributionConfig | undefined,
) => {
  if (shouldBlockBucketPublicAccess) {
    const isOACAlreadyAssociated = distributionConfig?.Origins.Items.find(
      (o) => o.Id === getS3DomainNameForBlockedBucket(domainName),
    );
    if (isOACAlreadyAssociated) {
      return true;
    }
  }

  if (!shouldBlockBucketPublicAccess) {
    const isS3WebsiteAlreadyAssociated = distributionConfig?.Origins.Items.find(
      (o) => o.Id === getS3DomainName(domainName),
    );
    if (isS3WebsiteAlreadyAssociated) {
      return true;
    }
  }
  return false;
};
