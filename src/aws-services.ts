import { S3 } from "aws-sdk";

export const bucketRegion = "eu-west-3";

export const s3 = new S3({
  apiVersion: "2006-03-01",
  region: bucketRegion
});
