import { ACM, waitUntilCertificateValidated } from '@aws-sdk/client-acm'
import { CloudFront, Distribution, waitUntilInvalidationCompleted } from '@aws-sdk/client-cloudfront'
import { IAM } from '@aws-sdk/client-iam'
import { Lambda } from '@aws-sdk/client-lambda'
import { Route53 } from '@aws-sdk/client-route-53'
import { S3 } from '@aws-sdk/client-s3'
import { logger } from './logger'

// Bucket region must be fixed so that website endpoint is fixe
// https://docs.aws.amazon.com/fr_fr/general/latest/gr/s3.html
export const bucketRegion = 'eu-west-3'

export const s3 = new S3({
  region: bucketRegion,
})

export const lambda = new Lambda({
  region: 'us-east-1',
})
export const iam = new IAM({
  region: 'us-east-1',
})

// cloudfront certificates must be in us-east-1
export const acm = new ACM({
  region: 'us-east-1',
})

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


// re-implement aws-sdk's waitUntilDistributionDeployed() because the aws-sdk one is bugged
const waitUntilDistributionDeployed = async (params: {
  client: CloudFront,
  maxWaitTime: number,
}, distribution: { Id: string }): Promise<Distribution> => {

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval)
      reject(new Error(`[CloudFront] ❌ Distribution not deployed after ${params.maxWaitTime} seconds`))
    }, params.maxWaitTime * 1000)

    const interval = setInterval(async () => {
      try {
        const { Distribution } = await params.client.getDistribution({ Id: distribution.Id })

        if (!Distribution) {
          return 
        }

        logger.info(`[CloudFront] 🔄 Checking distribution status: ${Distribution.Id} has status ${Distribution.Status}`)
        if (Distribution.Status === 'Deployed') {
          clearInterval(interval)
          clearTimeout(timeout)
          resolve(Distribution)
        }
      } catch (error) {
        clearInterval(interval)
        clearTimeout(timeout)
        reject(error)
      }
    }, 10000)
  });
}

export const waitUntil = {
  distributionDeployed: waitUntilDistributionDeployed,
  certificateValidated: waitUntilCertificateValidated,
  invalidationCompleted: waitUntilInvalidationCompleted,
}
