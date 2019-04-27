import { S3, ACM } from "aws-sdk";

// Bucket region must be fixed so that website endpoint is fixe
// https://docs.aws.amazon.com/fr_fr/general/latest/gr/rande.html#s3_website_region_endpoints
export const bucketRegion = "eu-west-3";

export const s3 = new S3({
  apiVersion: "2006-03-01",
  region: bucketRegion
});

// cloudfront certificates must be in us-east-1
export const acm = new ACM({ region: "us-east-1" });
