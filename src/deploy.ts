import { existsSync } from "fs";
import {
  doesS3BucketExists,
  createBucket,
  syncToS3,
  setBucketWebsite,
  setBucketPolicy
} from "./s3";

export const deploy = async (
  domainName: string,
  folder: string,
  hostedZoneName: string
) => {
  console.log(
    `Deploying "${folder}" on "${domainName}" (zone ${hostedZoneName})...`
  );

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

  console.log(`Uploading "${folder}" content...`);
  await syncToS3(folder, domainName);
};
