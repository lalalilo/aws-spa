# aws-spa

Deploy a single page app on AWS in one command.

[![CircleCI](https://circleci.com/gh/nicgirault/aws-spa.svg?style=svg)](https://circleci.com/gh/nicgirault/aws-spa) [![codecov](https://codecov.io/gh/nicgirault/aws-spa/branch/master/graph/badge.svg)](https://codecov.io/gh/nicgirault/aws-spa)

## Install & use

```bash
npm install --dev aws-spa
# or
yarn add --dev aws-spa

# then
npx aws-spa deploy hello.example.com --directory build
```

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

## Get Started

### With create-react-app

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

## Use path to deploy multiple apps in the same s3 bucket

You can specify a path such as

```
npx aws-spa deploy hello.example.com/some-path --directory build
```

It will deploy the app in the bucket `hello.example.com` in the folder `some-path`. This can be useful to deploy multiple versions of the same app in a s3 bucket. For example one could deploy a feature branch of the SPA like this:

```
npx aws-spa deploy hello.example.com/$(git branch | grep \* | cut -d ' ' -f2)
```

## IAM

TODO: complete the required access.

## FAQ

### Why not using Ansible, Saltstack, Terraform, Cloudformation, Troposphere, etc?

If it better suits your use case, these tools are probably a very good choice because there are done for this. Meanwhile there are some reasons why it is written in javascript:

- in my CI/CD installing Ansible, awscli or Terraform takes more than 1 minute. Since my SPA needs nodejs to be built, having a the same dependency to deploy is convenient & fast.
- Developers would have to learn these tools while they have already tons of things to learn. Using a script in the same language that they develop is nice.
- These tools are quite heavy while deploying a SPA requires only a couple of AWS API calls.
