# aws-spa

Deploy a single page app on AWS in one command.

[![CircleCI](https://circleci.com/gh/nicgirault/aws-spa.svg?style=svg)](https://circleci.com/gh/nicgirault/aws-spa) [![codecov](https://codecov.io/gh/nicgirault/aws-spa/branch/master/graph/badge.svg)](https://codecov.io/gh/nicgirault/aws-spa)

![first deployment](https://raw.githubusercontent.com/nicgirault/aws-spa/master/docs/first-deployment.png)

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
- Basic Auth (recommended to avoid search engine indexation)
- idempotent script

## Get Started

### With create-react-app

```
npx create-react-app hello-world && cd hello-world
yarn add aws-spa
yarn build
npx aws-spa deploy hello.example.com
```

## API

### aws-spa deploy

Deploy a single page app on AWS

#### Positionals:

- domainName:

The domain name on which the SPA will be accessible. For example "app.example.com".

You can also specify a path: "app.example.com/something". This can be useful to deploy multiple versions of the app in the same s3 bucket. For example one could deploy a feature branch of the SPA like this:

```bash
aws-spa deploy app.example.com/$(git branch | grep * | cut -d ' ' -f2)
```

#### Options:

- `--wait`: Wait for CloudFront distribution to be deployed & cache invalidation to be completed. If you choose not to wait (default), you won't see site changes as soon as the command ends.
- `--directory`: The directory where the static files have been generated. It must contain an index.html
- `--credentials` This option enables basic auth for the full s3 bucket (even if the domainName specifies a path). Credentials must be of the form "username:password". Basic auth is the recommened way to avoid search engine indexation of non-production apps (such as staging)

## Migrate an existing SPA on aws-spa

aws-spa is aware of the resources it is managing thanks to tags.

If a S3 bucket named with the domain name already exists, a prompt will ask you if want to deleguate the management of this bucket to aws-s3.

If a CloudFront distribution with this S3 bucket already exists, the script will fail because CloudFront distribution update is quite complicated.

- If you don't care about downtime, you can delete the CloudFront distribution first.
- If you care about downtime, you can configure the CloudFront distribution by yourself (don't forget to gzip the files) and then add the tag key: `managed-by-aws-spa`, value: `v1`.

## IAM

cloudfront:CreateDistribution
TODO: complete missing policies

### If using simple auth

lambda:GetFunction
lambda:EnableReplication\*
iam:CreateServiceLinkedRole

## FAQ

### Why not using Ansible, Saltstack, Terraform, Cloudformation, Troposphere, etc?

If it better suits your use case, these tools are probably a very good choice because there are done for this. Meanwhile there are some reasons why it is written in javascript:

- in my CI/CD installing Ansible, awscli or Terraform takes more than 1 minute. Since my SPA needs nodejs to be built, having a the same dependency to deploy is convenient & fast.
- Developers would have to learn these tools while they have already tons of things to learn. Using a script in the same language that they develop is nice.
- These tools are quite heavy while deploying a SPA requires only a couple of AWS API calls.
