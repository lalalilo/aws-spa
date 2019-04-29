# aws-spa

A no-brainer script to deploy a single page app on AWS.

[![CircleCI](https://circleci.com/gh/nicgirault/aws-spa.svg?style=svg)](https://circleci.com/gh/nicgirault/aws-spa) [![codecov](https://codecov.io/gh/nicgirault/aws-spa/branch/master/graph/badge.svg)](https://codecov.io/gh/nicgirault/aws-spa)

## Features

- Create AWS Bucket & CloudFront distribution & Route 53 record & ACM certificate and configure it
- Serve gzipped file
- Smart HTTP cache
- Invalidate CloudFront after deployment

This script is idempotent.

Here is a quick overview of what it is doing for the first deployment:

![first deployment](https://raw.githubusercontent.com/nicgirault/aws-spa/master/docs/first-deployment.png)

Don't worry, the script will fail if the S3 Bucket or the CloudFront distribution have not been created by this script.

Then, on following deployments:

![following deployments](https://raw.githubusercontent.com/nicgirault/aws-spa/master/docs/next-deployments.png)

## How to use

```
npx create-react-app hello-world && cd hello-world && yarn build
yarn add aws-spa
npx aws-spa deploy hello.example.com --directory build
```

You can also add a flag `--wait` if you want the script to wait for CloudFront async actions (complete cache invalidation & distribution creation). If you choose not to wait, you won't see site changes as soon as the command ends.

## IAM

TODO: complete the required access.

## Notes

### about cache control

The cache control strategy follows the recommendation described here https://facebook.github.io/create-react-app/docs/production-build#static-file-caching so it means that all your asset files should have a hash append to their filename. Otherwise they won't be reloaded in your users' browser after a new deployment with changes in the file.
