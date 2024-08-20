import { S3, ACM, CloudFront, Route53, Lambda, IAM } from 'aws-sdk'

// Bucket region must be fixed so that website endpoint is fixe
// https://docs.aws.amazon.com/fr_fr/general/latest/gr/s3.html
export const bucketRegion = 'eu-west-3'

export const s3 = new S3({
  apiVersion: '2006-03-01',
  region: bucketRegion,
})

export const lambda = new Lambda({ region: 'us-east-1' })
export const iam = new IAM({ region: 'us-east-1', apiVersion: '2010-05-08' })

// cloudfront certificates must be in us-east-1
export const acm = new ACM({ region: 'us-east-1' })

export const cloudfront = new CloudFront()

export const route53 = new Route53()

// S3 API does not seem to expose this data
// https://docs.aws.amazon.com/fr_fr/general/latest/gr/s3.html
export const websiteEndpoint = {
  'us-east-2': 's3-website.us-east-2.amazonaws.com',
  'us-east-1': 's3-website-us-east-1.amazonaws.com',
  'us-west-1': 's3-website-us-west-1.amazonaws.com',
  'us-west-2': 's3-website-us-west-2.amazonaws.com',
  'ap-south-1': 's3-website.ap-south-1.amazonaws.com',
  'ap-northeast-3': 's3-website.ap-northeast-3.amazonaws.com',
  'ap-northeast-2': 's3-website.ap-northeast-2.amazonaws.com',
  'ap-southeast-1': 's3-website-ap-southeast-1.amazonaws.com',
  'ap-southeast-2': 's3-website-ap-southeast-2.amazonaws.com',
  'ap-northeast-1': 's3-website-ap-northeast-1.amazonaws.com',
  'ca-central-1': 's3-website.ca-central-1.amazonaws.com',
  'cn-northwest-1': 's3-website.cn-northwest-1.amazonaws.com.cn',
  'eu-central-1': 's3-website.eu-central-1.amazonaws.com',
  'eu-west-1': 's3-website-eu-west-1.amazonaws.com',
  'eu-west-2': 's3-website.eu-west-2.amazonaws.com',
  'eu-west-3': 's3-website.eu-west-3.amazonaws.com',
  'eu-north-1': 's3-website.eu-north-1.amazonaws.com',
  'sa-east-1': 's3-website-sa-east-1.amazonaws.com',
}

export const getS3DomainNameForBlockedBucket = (domainName: string) =>
  `${domainName}.s3.${bucketRegion}.amazonaws.com`

export const getS3DomainName = (domainName: string) =>
  `${domainName}.${websiteEndpoint[bucketRegion]}`

export const getOriginId = (domainName: string) =>
  `S3-Website-${getS3DomainName(domainName)}`
