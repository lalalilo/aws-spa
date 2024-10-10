import * as CloudfrontAWS from '@aws-sdk/client-cloudfront'
import {
  createCloudFrontDistribution,
  findDeployedCloudfrontDistribution,
  getCacheInvalidations,
  identifyingTag,
  invalidateCloudfrontCache,
  invalidateCloudfrontCacheWithRetry,
  updateCloudFrontDistribution
} from '.'
import {
  cloudfront,
  getOriginId,
  getS3DomainName,
  getS3DomainNameForBlockedBucket,
} from '../aws-services'
import { awsReject, awsResolve } from '../test-helper'

describe('cloudfront', () => {
  describe('findDeployedCloudfrontDistribution', () => {
    const listDistributionMock = jest.spyOn(cloudfront, 'listDistributions')
    const listTagsForResourceMock = jest.spyOn(
      cloudfront,
      'listTagsForResource'
    )
    const waitForMock = jest.spyOn(CloudfrontAWS, 'waitUntilDistributionDeployed')

    afterEach(() => {
      listDistributionMock.mockReset()
      listTagsForResourceMock.mockReset()
      waitForMock.mockReset()
    })

    it('should return the distribution even if on page 2', async () => {
      listDistributionMock
        .mockReturnValueOnce(
          awsResolve({
            DistributionList: {
              NextMarker: 'xxx',
              Items: [
                {
                  Id: 'GOODBYE',
                  Aliases: {
                    Items: ['goodbye.example.com'],
                  },
                },
              ],
            },
          })
        )
        .mockReturnValueOnce(
          awsResolve({
            DistributionList: {
              Items: [
                {
                  Id: 'HELLO',
                  Status: 'Deployed',
                  Aliases: {
                    Items: ['hello.example.com'],
                  },
                },
              ],
            },
          })
        )

      listTagsForResourceMock.mockReturnValue(
        awsResolve({
          Tags: {
            Items: [identifyingTag],
          },
        })
      )

      const distribution: any =
        await findDeployedCloudfrontDistribution('hello.example.com')
      expect(distribution).toBeDefined()
      expect(distribution.Id).toEqual('HELLO')
    })

    it('should wait for distribution if distribution is not deployed', async () => {
      listDistributionMock.mockReturnValue(
        awsResolve({
          DistributionList: {
            Items: [
              {
                Id: 'HELLO',
                Status: 'In Progress',
                Aliases: {
                  Items: ['hello.example.com'],
                },
              },
            ],
          },
        })
      )

      listTagsForResourceMock.mockReturnValue(
        awsResolve({
          Tags: {
            Items: [identifyingTag],
          },
        })
      )
      waitForMock.mockReturnValue(awsResolve())

      await findDeployedCloudfrontDistribution('hello.example.com')
      expect(waitForMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('invalidateCloudfrontCache', () => {
    const createInvalidationMock = jest.spyOn(cloudfront, 'createInvalidation')
    const waitForMock = jest.spyOn(CloudfrontAWS, 'waitUntilInvalidationCompleted')

    afterEach(() => {
      createInvalidationMock.mockReset()
      waitForMock.mockReset()
    })

    it('should invalidate the specified path', async () => {
      createInvalidationMock.mockReturnValue(awsResolve({ Invalidation: {} }))
      await invalidateCloudfrontCache('some-distribution-id', 'index.html')

      expect(createInvalidationMock).toHaveBeenCalledTimes(1)
      const invalidationParams: any = createInvalidationMock.mock.calls[0][0]
      expect(invalidationParams.DistributionId).toEqual('some-distribution-id')
      expect(invalidationParams.InvalidationBatch.Paths.Items[0]).toEqual(
        'index.html'
      )
    })

    it('should invalidate the specified paths', async () => {
      createInvalidationMock.mockReturnValue(awsResolve({ Invalidation: {} }))
      await invalidateCloudfrontCache(
        'some-distribution-id',
        'index.html, static/*'
      )

      expect(createInvalidationMock).toHaveBeenCalledTimes(1)
      const invalidationParams: any = createInvalidationMock.mock.calls[0][0]
      expect(invalidationParams.DistributionId).toEqual('some-distribution-id')
      expect(invalidationParams.InvalidationBatch.Paths.Items).toEqual([
        'index.html',
        'static/*',
      ])
    })

    it('should wait for invalidate if wait flag is true', async () => {
      createInvalidationMock.mockReturnValue(awsResolve({ Invalidation: {} }))
      waitForMock.mockReturnValue(awsResolve())
      await invalidateCloudfrontCache(
        'some-distribution-id',
        'index.html',
        true
      )
      expect(waitForMock).toHaveBeenCalledTimes(1)
      expect(waitForMock.mock.calls[0][0]).toEqual('invalidationCompleted')
    })
  })

  describe('invalidateCloudfrontCacheWithRetry', () => {
    const createInvalidationMock = jest.spyOn(cloudfront, 'createInvalidation')
    const waitForMock = jest.spyOn(CloudfrontAWS, 'waitUntilInvalidationCompleted')

    afterEach(() => {
      createInvalidationMock.mockReset()
      waitForMock.mockReset()
    })
    it('should retry once', async () => {
      createInvalidationMock
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsResolve({ Invalidation: {} }))

      await invalidateCloudfrontCacheWithRetry(
        'some-distribution-id',
        'index.html, static/*'
      )

      expect(createInvalidationMock).toHaveBeenCalledTimes(2)
    })

    it('should retry 5 times at most', async () => {
      createInvalidationMock
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsResolve({ Invalidation: {} }))

      try {
        await invalidateCloudfrontCacheWithRetry(
          'some-distribution-id',
          'index.html, static/*'
        )
      } catch (error) {
        expect(error).toBeDefined()
      }

      expect(createInvalidationMock).toHaveBeenCalledTimes(5)
    })
  })

  describe('createCloudFrontDistribution', () => {
    const createDistributionMock = jest.spyOn(cloudfront, 'createDistribution')
    const waitForMock = jest.spyOn(CloudfrontAWS, 'waitUntilDistributionDeployed')
    const tagResourceMock = jest.spyOn(cloudfront, 'tagResource')

    afterEach(() => {
      createDistributionMock.mockReset()
      waitForMock.mockReset()
      tagResourceMock.mockReset()
    })

    it('should create a distribution and wait for it to be available', async () => {
      const distribution = { Id: 'distribution-id' }
      createDistributionMock.mockReturnValue(
        awsResolve({ Distribution: distribution })
      )
      tagResourceMock.mockReturnValue(awsResolve())
      waitForMock.mockReturnValue(awsResolve())
      const result = await createCloudFrontDistribution(
        'hello.lalilo.com',
        'arn:certificate',
      )
      expect(result).toBe(distribution)
      expect(tagResourceMock).toHaveBeenCalledTimes(1)
      expect(createDistributionMock).toHaveBeenCalledTimes(1)
      const distributionParam: any = createDistributionMock.mock.calls[0][0]
      const distributionConfig = distributionParam.DistributionConfig
      expect(distributionConfig.Origins.Items[0].DomainName).toEqual(
        'hello.lalilo.com.s3-website.eu-west-3.amazonaws.com'
      )
      expect(
        distributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy
      ).toEqual('redirect-to-https')
      expect(distributionConfig.DefaultCacheBehavior.MinTTL).toEqual(0)
      expect(distributionConfig.DefaultCacheBehavior.Compress).toEqual(true)
      expect(distributionConfig.ViewerCertificate.ACMCertificateArn).toEqual(
        'arn:certificate'
      )

      expect(waitForMock).toHaveBeenCalledTimes(1)
      expect(waitForMock).toHaveBeenCalledWith('distributionDeployed', {
        Id: 'distribution-id',
      })
    })
  })

  describe('getCacheInvalidations', () => {
    it.each([
      { input: 'index.html', expectedOutput: '/index.html' },
      { input: '/index.html', expectedOutput: '/index.html' },
      {
        input: 'index.html, hello.html',
        subFolder: undefined,
        expectedOutput: '/index.html,/hello.html',
      },
      {
        input: 'index.html',
        subFolder: 'some-branch',
        expectedOutput: '/some-branch/index.html',
      },
    ])('add missing slash', ({ input, subFolder, expectedOutput }) => {
      expect(getCacheInvalidations(input, subFolder)).toEqual(expectedOutput)
    })
  })

  describe('updateCloudFrontDistribution', () => {
    const getDistributionConfigMock = jest.spyOn(
      cloudfront,
      'getDistributionConfig'
    )
    const updateDistribution = jest.spyOn(cloudfront, 'updateDistribution')
    const listFunctions = jest.spyOn(cloudfront, 'listFunctions')
    const createFunction = jest.spyOn(cloudfront, 'createFunction')
    const publishFunction = jest.spyOn(cloudfront, 'publishFunction')

    beforeEach(() => {
      getDistributionConfigMock.mockReset()
      updateDistribution.mockReset()
      listFunctions.mockReturnValueOnce(awsResolve({ Functions: [] }))
      publishFunction.mockReturnValue(awsResolve({}))
      createFunction.mockReturnValue(awsResolve({ ETag: 'lol', FunctionSummary: { FunctionMetadata: { Id: 'oac-id', FunctionARN: 'plop' } } }))
    })

    it.each([
      {
        shouldBlockBucketPublicAccess: true,
        noDefaultRootObject: false,
      },
      { shouldBlockBucketPublicAccess: false, noDefaultRootObject: false },
      {
        shouldBlockBucketPublicAccess: true,
        noDefaultRootObject: true,
      },
      { shouldBlockBucketPublicAccess: false, noDefaultRootObject: true },
    ])(
      `should not update the distribution if the configuration doesn't change %p`,
      async ({ shouldBlockBucketPublicAccess, noDefaultRootObject }) => {
        if (noDefaultRootObject) {
          listFunctions.mockReturnValueOnce(
            awsResolve({
              Functions: [{ FunctionConfig: { FunctionMetadata: { Id: 'oac-id', FunctionARN: 'plop' } } }],
            })
          )
        }
        const domainName = 'hello.lalilo.com'
        const originId = shouldBlockBucketPublicAccess
          ? getS3DomainNameForBlockedBucket(domainName)
          : getOriginId(domainName)
        const originDomainName = shouldBlockBucketPublicAccess
          ? getS3DomainNameForBlockedBucket(domainName)
          : getS3DomainName(domainName)

        const distribution = {
          Id: 'distribution-id',
          DefaultRootObject: noDefaultRootObject ? '' : 'index.html',
          Origins: { Quantity: 1, Items: [{ Id: originId, DomainName: originDomainName }] },
          DefaultCacheBehavior: {
            TargetOriginId: originId,
            ...(noDefaultRootObject && { FunctionAssociations: {
              Quantity: 1,
              Items: [{
                FunctionARN: 'plop',
                EventType: 'viewer-request',
              }]
            }})
          },
        }

        getDistributionConfigMock.mockReturnValue(
          awsResolve({ DistributionConfig: distribution })
        )

        if (shouldBlockBucketPublicAccess) {
          await updateCloudFrontDistribution(distribution.Id, domainName, {
            shouldBlockBucketPublicAccess,
            noDefaultRootObject,
            oac: { originAccessControl: { Id: 'oac-id' }, ETag: 'etag' }
          }) 
        } else {
          await updateCloudFrontDistribution(distribution.Id, domainName, {
            shouldBlockBucketPublicAccess,
            noDefaultRootObject,
            oac: null
          })
        }

        expect(updateDistribution).not.toHaveBeenCalled()
      }
    )

    it('should update the distribution with an OAC when shouldBlockBucketPublicAccess and oac is given', async () => {
      const domainName = 'hello.lalilo.com'
      const originIdForPrivateBucket =
        getS3DomainNameForBlockedBucket(domainName)

      const oac = { originAccessControl: { Id: 'oac-id' }, ETag: 'etag' }
      const distribution = {
        Id: 'distribution-id',
        Origins: { Items: [{ DomainName: getS3DomainName(domainName) }] },
        DefaultCacheBehavior: {
          TargetOriginId: getS3DomainName(domainName),
        },
      }

      getDistributionConfigMock.mockReturnValue(
        awsResolve({ DistributionConfig: distribution })
      )

      updateDistribution.mockReturnValueOnce(awsResolve())
      await updateCloudFrontDistribution(distribution.Id, domainName, {
        shouldBlockBucketPublicAccess: true,
        noDefaultRootObject: false,
        oac,
      })

      expect(updateDistribution).toHaveBeenCalled()
      expect(updateDistribution).toHaveBeenCalledWith(
        expect.objectContaining({
          DistributionConfig: expect.objectContaining({
            DefaultRootObject: 'index.html',
            Origins: expect.objectContaining({
              Items: [
                expect.objectContaining({
                  Id: originIdForPrivateBucket,
                  DomainName: originIdForPrivateBucket,
                  OriginAccessControlId: oac.originAccessControl.Id,
                  S3OriginConfig: {
                    OriginAccessIdentity: '',
                  },
                }),
              ],
            }),
            DefaultCacheBehavior: expect.objectContaining({
              TargetOriginId: originIdForPrivateBucket,
            }),
          }),
        })
      )
    })

    it.each([{ noDefaultRootObject: false }, { noDefaultRootObject: true }])(
      `should update the distribution if the defaultRootObject if different from the existing config (and not touch to other config) %p`,
      async ({ noDefaultRootObject }) => {
        const domainName = 'hello.lalilo.com'
        const originIdForPrivateBucket =
          getS3DomainNameForBlockedBucket(domainName)

        const oac = { originAccessControl: { Id: 'oac-id' }, ETag: 'etag' }
      
        const distribution = {
          Id: 'distribution-id',
          Origins: { Items: [{ DomainName: originIdForPrivateBucket }] },
          DefaultCacheBehavior: {
            TargetOriginId: originIdForPrivateBucket,
          },
          DefaultRootObject: noDefaultRootObject ? 'index.html' : '',
        }

        const originalConfig = awsResolve({ DistributionConfig: distribution })

        getDistributionConfigMock.mockReturnValue(originalConfig)

        updateDistribution.mockReturnValueOnce(awsResolve())
        await updateCloudFrontDistribution(distribution.Id, domainName, {
          shouldBlockBucketPublicAccess: true,
          noDefaultRootObject,
          oac,
        })

        expect(updateDistribution).toHaveBeenCalled()
        expect(updateDistribution).toHaveBeenCalledWith(
          expect.objectContaining({
            DistributionConfig: expect.objectContaining({
              DefaultRootObject: noDefaultRootObject ? '' : 'index.html',
              Origins: expect.objectContaining({
                Items: [
                  expect.objectContaining({
                    DomainName: originIdForPrivateBucket,
                  }),
                ],
              }),
              DefaultCacheBehavior: expect.objectContaining({
                TargetOriginId: originIdForPrivateBucket,
              }),
            }),
          })
        )
      }
    )
  })
})
