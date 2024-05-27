import { Tag } from "aws-sdk/clients/s3";
import { createReadStream } from "fs";
import inquirer from "inquirer";
import { lookup } from "mime-types";

import { s3 } from "./aws-services";
import { readRecursively } from "./fs-helper";
import { logger } from "./logger";
export const doesS3BucketExists = async (bucketName: string) => {
  try {
    logger.info(`[S3] 🔍 Looking for bucket "${bucketName}"...`);
    await s3.headBucket({ Bucket: bucketName }).promise();
  } catch (error: any) {
    if (error.statusCode === 404) {
      logger.info(`[S3] 😬 Bucket "${bucketName}" not found...`);
      return false;
    }

    throw error;
  }

  logger.info(`[S3] 🔍 Bucket "${bucketName}" found`);
  return true;
};

export const createBucket = async (bucketName: string) => {
  logger.info(`[S3] ✏️ Creating "${bucketName}" bucket...`);
  try {
    await s3
      .createBucket({
        Bucket: bucketName,
      })
      .promise();
  } catch (error: any) {
    if (error.statusCode === 409) {
      throw new Error(
        "[S3] It seems that a bucket already exists but in an unsupported region... You should delete it first."
      );
    }
    throw error;
  }
};

export const confirmBucketManagement = async (bucketName: string) => {
  logger.info(
    `[S3] 🔍 Checking that tag "${identifyingTag.Key}:${identifyingTag.Value}" exists on bucket "${bucketName}"...`
  );
  try {
    const { TagSet } = await s3
      .getBucketTagging({ Bucket: bucketName })
      .promise();

    const tag = TagSet.find(
      (_tag) =>
        _tag.Key === identifyingTag.Key && _tag.Value === identifyingTag.Value
    );

    if (tag) {
      logger.info(
        `[S3] 👍 Tag "${identifyingTag.Key}:${identifyingTag.Value}" found`
      );
      return true;
    }
  } catch (error: any) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  const { continueUpdate } = await inquirer.prompt([
    {
      type: "confirm",
      name: "continueUpdate",
      message: `[S3] Bucket "${bucketName}" is not yet managed by aws-spa. Would you like it to be modified (public access & website config) & managed by aws-spa?`,
      default: false,
    },
  ]);
  if (continueUpdate) {
    return true;
  }
  throw new Error("You can use another domain name or delete the S3 bucket...");
};

export const tagBucket = async (bucketName: string) => {
  logger.info(
    `[S3] ✏️ Tagging "${bucketName}" bucket with "${identifyingTag.Key}:${identifyingTag.Value}"...`
  );
  await s3
    .putBucketTagging({
      Bucket: bucketName,
      Tagging: {
        TagSet: [identifyingTag],
      },
    })
    .promise();
};

export const removeBucketWebsite = (bucketName: string) => {
  logger.info(
    `[S3] 🔏 Ensure bucket "${bucketName}" is not a static website hoisting`
  );
  try {
    return s3.deleteBucketWebsite({ Bucket: bucketName }).promise();
  } catch (error) {
    logger.error(
      `[S3] ❌ Error when removing static website hoisting for bucket "${bucketName}"`,
      error
    );
  }
};

export const setBucketWebsite = (bucketName: string) => {
  logger.info(
    `[S3] ✏️ Set bucket website with IndexDocument: "index.html" & ErrorDocument: "index.html" to "${bucketName}"...`
  );
  return s3
    .putBucketWebsite({
      Bucket: bucketName,
      WebsiteConfiguration: {
        ErrorDocument: {
          Key: "index.html",
        },
        IndexDocument: {
          Suffix: "index.html",
        },
      },
    })
    .promise();
};

export const setBucketPolicy = (bucketName: string) => {
  logger.info(`[S3] ✏️ Allow public read to "${bucketName}"...`);
  return s3
    .putBucketPolicy({
      Bucket: bucketName,
      Policy: JSON.stringify({
        Statement: [
          {
            Sid: "AllowPublicRead",
            Effect: "Allow",
            Principal: {
              AWS: "*",
            },
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucketName}/*`,
          },
        ],
      }),
    })
    .promise();
};

export const setBucketPolicyForOAC = (
  bucketName: string,
  distributionId: string
) => {
  logger.info(
    `[S3] 🔏 Allow distribution ${distributionId} to read from "${bucketName}"...`
  );
  try {
    return s3
      .putBucketPolicy({
        Bucket: bucketName,
        Policy: JSON.stringify({
          Statement: [
            {
              Sid: "AllowCloudFrontServicePrincipal",
              Effect: "Allow",
              Principal: {
                Service: "cloudfront.amazonaws.com",
              },
              Action: "s3:GetObject",
              Resource: `arn:aws:s3:::${bucketName}/*`,
              Condition: {
                StringEquals: {
                  "AWS:SourceArn": `arn:aws:cloudfront::651828462322:distribution/${distributionId}`,
                },
              },
            },
          ],
        }),
      })
      .promise();
  } catch (error) {
    logger.error(
      `[S3] ❌ Error when allowing distribution to read from "${bucketName}"`,
      error
    );
  }
};

export const blockBucketPublicAccess = (bucketName: string) => {
  logger.info(`[S3] 🔏 Block public access for bucket "${bucketName}"...`);
  const params = {
    Bucket: bucketName,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    },
  };

  try {
    return s3.putPublicAccessBlock(params).promise();
  } catch (error) {
    logger.error(
      `[S3] ❌ Error blocking public access for bucket "${bucketName}"`,
      error
    );
  }
};

export const allowBucketPublicAccess = (bucketName: string) => {
  logger.info(`[S3] ✅ Allow public access for bucket "${bucketName}"...`);
  try {
    return s3.deletePublicAccessBlock({ Bucket: bucketName }).promise();
  } catch (error) {
    logger.error(
      `[S3] ❌ Error allowing public access for bucket "${bucketName}"`,
      error
    );
  }
};

export const identifyingTag: Tag = {
  Key: "managed-by-aws-spa",
  Value: "v1",
};

export const syncToS3 = function (
  folder: string,
  bucketName: string,
  cacheBustedPrefix: string | undefined,
  subfolder?: string
) {
  logger.info(`[S3] ✏️ Uploading "${folder}" folder on "${bucketName}"...`);

  const filesToUpload = readRecursively(folder);
  return Promise.all(
    filesToUpload.map((file) => {
      const filenameParts = file.split(".");
      const key = file.replace(`${folder}/`, "");

      const prefix = subfolder ? `${subfolder}/` : "";
      return s3
        .putObject({
          Bucket: bucketName,
          Key: `${prefix}${key}`,
          Body: createReadStream(file),
          CacheControl: getCacheControl(key, cacheBustedPrefix),
          ContentType:
            lookup(filenameParts[filenameParts.length - 1]) ||
            "application/octet-stream",
        })
        .promise();
    })
  );
};

const getCacheControl = (
  filename: string,
  cacheBustedPrefix: string | undefined
) => {
  if (filename === "index.html") {
    // This will allow CloudFront to store the file on the edge location,
    // but it will force it to revalidate it with the origin with each request.
    // If the file hasn't changed, CloudFront will not need to transfer the
    // file's entire content from the origin.
    return "public, must-revalidate, proxy-revalidate, max-age=0";
  }

  if (cacheBustedPrefix && filename.startsWith(cacheBustedPrefix)) {
    // js & css files should have a hash so if index.html change: the js & css
    // file will change. It allows to have an aggressive cache for js & css files.
    return "max-age=31536000";
  }

  return undefined;
};
