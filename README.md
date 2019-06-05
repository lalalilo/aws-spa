# aws-spa

Deploy a single page app on AWS in one command.

[![CircleCI](https://circleci.com/gh/nicgirault/aws-spa.svg?style=svg)](https://circleci.com/gh/nicgirault/aws-spa) [![codecov](https://codecov.io/gh/nicgirault/aws-spa/branch/master/graph/badge.svg)](https://codecov.io/gh/nicgirault/aws-spa)

## Why?

Configuring the deployment of a single page app is harder than it should be. Most SPA configuration are very similar. aws-spa embodies this idea. It is meant to handle all the quirks associated with SPA configuration.

## Features

- Create AWS Bucket & CloudFront distribution & Route 53 record & ACM certificate and configure it
- Serve gzipped file
- [Smart](https://facebook.github.io/create-react-app/docs/production-build#static-file-caching) HTTP cache (cache busted files should be in the `static` subfolder of the build folder).
- Invalidate CloudFront after deployment

This script is idempotent.

Here is a quick overview of what it is doing for the first deployment:

![first deployment](https://raw.githubusercontent.com/nicgirault/aws-spa/master/docs/first-deployment.png)

## How to use

```
npx create-react-app hello-world
cd hello-world
yarn add aws-spa
yarn build
npx aws-spa deploy hello.example.com --directory build
```

You can also add a flag `--wait` if you want the script to wait for CloudFront cache invalidation to be completed. If you choose not to wait, you won't see site changes as soon as the command ends.

## Migrate an existing SPA on aws-spa

aws-spa is aware of the resources it is managing thanks to tags.

If a S3 bucket named with the domain name already exists, a prompt will ask you if want to deleguate the management of this bucket to aws-s3.

If a CloudFront distribution with this S3 bucket already exists, the script will fail because CloudFront distribution update is quite complicated.

- If you don't care about downtime, you can delete the CloudFront distribution first.
- If you care about downtime, you can configure the CloudFront distribution by yourself (don't forget to gzip the files) and then add the tag key: `managed-by-aws-spa`, value: `v1`.

## IAM

TODO: complete the required access.
