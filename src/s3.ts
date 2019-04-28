import { Tag } from "aws-sdk/clients/s3";
import { createReadStream } from "fs";
import { lookup } from "mime-types";

import { s3 } from "./aws-services";
import { readRecursively } from "./fs-helper";
import { logger } from "./logger";

export const doesS3BucketExists = async (bucketName: string) => {
  try {
    logger.info(`[S3] 🔍 Looking for bucket "${bucketName}"...`);
    await s3.headBucket({ Bucket: bucketName }).promise();
  } catch (error) {
    if (error.statusCode === 404) {
      logger.info(`[S3] 😬 Bucket "${bucketName}" not found...`);
      return false;
    }

    throw error;
  }

  logger.info(`[S3] 🔍 Bucket "${bucketName}" exists. Checking tags...`);

  const errorMessage = `[S3] Bucket "${bucketName}" does not seem to have been created by aws-spa. You can either delete the existing bucket or make sure it is well configured and add the tag "${
    identifyingTag.Key
  }:${identifyingTag.Value}"`;

  try {
    const { TagSet } = await s3
      .getBucketTagging({ Bucket: bucketName })
      .promise();
    for (const tag of TagSet) {
      if (
        tag.Key === identifyingTag.Key &&
        tag.Value === identifyingTag.Value
      ) {
        logger.info(
          `[S3] Tag 👍 "${identifyingTag.Key}:${identifyingTag.Value}" found`
        );
        return true;
      }
    }
    throw new Error(errorMessage);
  } catch (error) {
    if (error.statusCode === 404) {
      throw new Error(errorMessage);
    }
    throw error;
  }
};

export const createBucket = async (bucketName: string) => {
  logger.info(`[S3] ✏️ Creating "${bucketName}" bucket...`);
  try {
    await s3
      .createBucket({
        Bucket: bucketName
      })
      .promise();
  } catch (error) {
    if (error.statusCode === 409) {
      throw new Error(
        "[S3] It seems that a bucket already exists but in an unsupported region... You should delete it first."
      );
    }
    throw error;
  }

  logger.info(
    `[S3] ✏️ Add tag "${identifyingTag.Key}:${
      identifyingTag.Value
    }" to "${bucketName}"...`
  );
  await s3
    .putBucketTagging({
      Bucket: bucketName,
      Tagging: {
        TagSet: [identifyingTag]
      }
    })
    .promise();
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
          Key: "index.html"
        },
        IndexDocument: {
          Suffix: "index.html"
        }
      }
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
              AWS: "*"
            },
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucketName}/*`
          }
        ]
      })
    })
    .promise();
};

export const identifyingTag: Tag = {
  Key: "created-by",
  Value: "aws-spa"
};

// This will allow CloudFront to store the file on the edge location,
// but it will force it to revalidate it with the origin with each request.
// If the file hasn't changed, CloudFront will not need to transfer the
// file's entire content from the origin.
export const indexCacheControl =
  "public, must-revalidate, proxy-revalidate, max-age=0";

// js & css files should have a hash so if index.html change: the js & css
// file will change. It allows to have an aggressive cache for js & css files.
const nonIndexCacheControl = "max-age=31536000";

export const syncToS3 = function(folder: string, bucketName: string) {
  logger.info(`[S3] ✏️ Uploading "${folder}" folder on "${bucketName}"...`);

  const filesToUpload = readRecursively(folder);
  return Promise.all(
    filesToUpload.map(file => {
      const filenameParts = file.split(".");
      const key = file.replace(`${folder}/`, "");
      return s3
        .putObject({
          Bucket: bucketName,
          Key: key,
          Body: createReadStream(file),
          CacheControl:
            key === "index.html" ? indexCacheControl : nonIndexCacheControl,
          ContentType:
            lookup(filenameParts[filenameParts.length - 1]) ||
            "application/octet-stream"
        })
        .promise();
    })
  );
};
