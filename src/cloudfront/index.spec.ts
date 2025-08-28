import { EventType, FunctionStage } from '@aws-sdk/client-cloudfront'
import {
  createCloudFrontDistribution,
  findDeployedCloudfrontDistribution,
  getCacheInvalidations,
  identifyingTag,
  invalidateCloudfrontCache,
  invalidateCloudfrontCacheWithRetry,
  updateCloudFrontDistribution,
} from '.'
import {
  cloudfront,
  getOriginId,
  getS3DomainName,
  getS3DomainNameForBlockedBucket,
  waitUntil,
} from '../aws-services'
import { awsReject, awsResolve } from '../test-helper'

describe('cloudfront', () => {
  describe('findDeployedCloudfrontDistribution', () => {
    const listDistributionMock = jest.spyOn(cloudfront, 'listDistributions')
    const listTagsForResourceMock = jest.spyOn(
      cloudfront,
      'listTagsForResource'
    )

    const waitForMock = jest.spyOn(waitUntil, 'distributionDeployed')

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
    const waitForMock = jest.spyOn(waitUntil, 'invalidationCompleted')

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
      createInvalidationMock.mockReturnValue(
        awsResolve({
          Invalidation: {
            Id: 'some-invalidation-id',
          },
        })
      )
      waitForMock.mockReturnValue(awsResolve())
      await invalidateCloudfrontCache(
        'some-distribution-id',
        'index.html',
        true
      )
      expect(waitForMock).toHaveBeenCalledTimes(1)
      expect(waitForMock).toHaveBeenCalledWith(expect.anything(), {
        DistributionId: 'some-distribution-id',
        Id: 'some-invalidation-id',
      })
    })
  })

  describe('invalidateCloudfrontCacheWithRetry', () => {
    const createInvalidationMock = jest.spyOn(cloudfront, 'createInvalidation')
    const waitForMock = jest.spyOn(waitUntil, 'invalidationCompleted')

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
    const waitForMock = jest.spyOn(waitUntil, 'distributionDeployed')
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
        'arn:certificate'
      )
      expect(result).toEqual(distribution)
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
      expect(waitForMock).toHaveBeenCalledWith(expect.anything(), {
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
      listFunctions.mockReturnValue(
        awsResolve({
          FunctionList: { Items: [] },
        })
      )
      publishFunction.mockReturnValue(awsResolve({}))
      createFunction.mockReturnValue(
        awsResolve({
          ETag: 'lol',
          FunctionSummary: {
            FunctionMetadata: { Id: 'oac-id', FunctionARN: 'plop' },
          },
        })
      )
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
              FunctionList: {
                Items: [
                  {
                    FunctionConfig: {
                      FunctionMetadata: { Id: 'oac-id', FunctionARN: 'plop' },
                    },
                  },
                ],
              },
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
          Alias: { Quantity: 1, Items: [originDomainName] },
          Origins: {
            Quantity: 1,
            Items: [{ Id: originId, DomainName: originDomainName }],
          },
          DefaultCacheBehavior: {
            TargetOriginId: originId,
            ...(noDefaultRootObject
              ? {
                  FunctionAssociations: {
                    Quantity: 1,
                    Items: [
                      {
                        FunctionARN: 'plop',
                        EventType: 'viewer-request',
                      },
                    ],
                  },
                }
              : {
                  FunctionAssociations: {
                    Quantity: 0,
                    Items: [],
                  },
                }),
          },
        }

        getDistributionConfigMock.mockReturnValue(
          awsResolve({ DistributionConfig: distribution })
        )

        if (shouldBlockBucketPublicAccess) {
          await updateCloudFrontDistribution(distribution.Id, domainName, {
            additionalDomainNames: [],
            cloudFrontFunctionsAssignments: {
              'origin-request': [],
              'origin-response': [],
              'viewer-request': [],
              'viewer-response': [],
            },
            shouldBlockBucketPublicAccess,
            noDefaultRootObject,
            oac: { originAccessControl: { Id: 'oac-id' }, ETag: 'etag' },
            redirect403ToRoot: false,
          })
        } else {
          await updateCloudFrontDistribution(distribution.Id, domainName, {
            additionalDomainNames: [],
            cloudFrontFunctionsAssignments: {
              'origin-request': [],
              'origin-response': [],
              'viewer-request': [],
              'viewer-response': [],
            },
            shouldBlockBucketPublicAccess,
            noDefaultRootObject,
            oac: null,
            redirect403ToRoot: false,
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
        Aliases: { Quantity: 1, Items: [domainName] },
        DefaultCacheBehavior: {
          TargetOriginId: getS3DomainName(domainName),
        },
      }

      getDistributionConfigMock.mockReturnValue(
        awsResolve({ DistributionConfig: distribution })
      )

      updateDistribution.mockReturnValueOnce(awsResolve())
      await updateCloudFrontDistribution(distribution.Id, domainName, {
        additionalDomainNames: [],
        cloudFrontFunctionsAssignments: {
          'origin-request': [],
          'origin-response': [],
          'viewer-request': [],
          'viewer-response': [],
        },
        shouldBlockBucketPublicAccess: true,
        noDefaultRootObject: false,
        oac,
        redirect403ToRoot: false,
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
          Aliases: { Quantity: 1, Items: [domainName] },
          DefaultCacheBehavior: {
            TargetOriginId: originIdForPrivateBucket,
          },
          DefaultRootObject: noDefaultRootObject ? 'index.html' : '',
        }

        const originalConfig = awsResolve({ DistributionConfig: distribution })

        getDistributionConfigMock.mockReturnValue(originalConfig)

        updateDistribution.mockReturnValueOnce(awsResolve())
        await updateCloudFrontDistribution(distribution.Id, domainName, {
          additionalDomainNames: [],
          cloudFrontFunctionsAssignments: {
            'origin-request': [],
            'origin-response': [],
            'viewer-request': [],
            'viewer-response': [],
          },
          shouldBlockBucketPublicAccess: true,
          noDefaultRootObject,
          oac,
          redirect403ToRoot: false,
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

    it('only uses the most recent LIVE functions', async () => {
      const domainName = 'hello.lalilo.com'
      const originIdForPrivateBucket =
        getS3DomainNameForBlockedBucket(domainName)

      listFunctions.mockReturnValue(
        awsResolve({
          FunctionList: {
            Items: [
              {
                FunctionMetadata: {
                  LastModifiedTime: new Date('2025-08-08'),
                  Stage: FunctionStage.DEVELOPMENT,
                  FunctionARN: 'ARN_dev',
                },
                Name: 'function1',
              },

              {
                FunctionMetadata: {
                  LastModifiedTime: new Date('2025-06-08'),
                  Stage: FunctionStage.LIVE,
                  FunctionARN: 'ARN_live_old',
                },
                Name: 'function1',
              },
              {
                FunctionMetadata: {
                  LastModifiedTime: new Date('2025-07-08'),
                  Stage: FunctionStage.LIVE,
                  FunctionARN: 'ARN_live_recent',
                },
                Name: 'function1',
              },
            ],
          },
        })
      )

      const distribution = {
        Id: 'distribution-id',
        Origins: { Items: [{ DomainName: originIdForPrivateBucket }] },
        Aliases: { Quantity: 1, Items: [domainName] },
        CustomErrorResponses: {
          Quantity: 0,
        },
      }

      getDistributionConfigMock.mockReturnValue(
        awsResolve({ DistributionConfig: distribution })
      )

      updateDistribution.mockReturnValueOnce(awsResolve())
      await updateCloudFrontDistribution(distribution.Id, domainName, {
        additionalDomainNames: [],
        cloudFrontFunctionsAssignments: {
          'origin-request': ['function1'],
          'origin-response': [],
          'viewer-request': [],
          'viewer-response': [],
        },
        shouldBlockBucketPublicAccess: false,
        noDefaultRootObject: false,
        oac: null,
        redirect403ToRoot: true,
      })

      expect(updateDistribution).toHaveBeenCalled()

      expect(updateDistribution).toHaveBeenCalledWith(
        expect.objectContaining({
          DistributionConfig: expect.objectContaining({
            DefaultCacheBehavior: expect.objectContaining({
              FunctionAssociations: {
                Quantity: 1,
                Items: [
                  {
                    FunctionARN: 'ARN_live_recent',
                    EventType: EventType.origin_request,
                  },
                ],
              },
            }),
          }),
        })
      )
    })

    it.each([
      {
        originRequestFunctionNames: [],
        viewerRequestFunctionNames: [],
        withNoDefaultRootObjectFunction: false,
      },
      {
        originRequestFunctionNames: [],
        viewerRequestFunctionNames: [],
        withNoDefaultRootObjectFunction: true,
      },
      {
        originRequestFunctionNames: ['newFunction1', 'newFunction2'],
        viewerRequestFunctionNames: ['newFunction3'],
        withNoDefaultRootObjectFunction: false,
      },
      {
        originRequestFunctionNames: ['newFunction1', 'newFunction2'],
        viewerRequestFunctionNames: ['newFunction3'],
        withNoDefaultRootObjectFunction: true,
      },
    ])(
      'should override existing distribution functions by provided one',
      async ({
        originRequestFunctionNames,
        viewerRequestFunctionNames,
        withNoDefaultRootObjectFunction,
      }) => {
        const domainName = 'hello.lalilo.com'
        const originIdForPrivateBucket =
          getS3DomainNameForBlockedBucket(domainName)

        listFunctions.mockReturnValue(
          awsResolve({
            FunctionList: {
              Items: [
                {
                  FunctionMetadata: {
                    LastModifiedTime: new Date('2025-06-08'),
                    Stage: FunctionStage.LIVE,
                    FunctionARN: 'newFunction1ARN',
                  },
                  Name: 'newFunction1',
                },
                {
                  FunctionMetadata: {
                    LastModifiedTime: new Date('2025-06-08'),
                    Stage: FunctionStage.LIVE,
                    FunctionARN: 'newFunction2ARN',
                  },
                  Name: 'newFunction2',
                },
                {
                  FunctionMetadata: {
                    LastModifiedTime: new Date('2025-06-08'),
                    Stage: FunctionStage.LIVE,
                    FunctionARN: 'newFunction3ARN',
                  },
                  Name: 'newFunction3',
                },
              ],
            },
          })
        )

        const distribution = {
          Id: 'distribution-id',
          Origins: { Items: [{ DomainName: originIdForPrivateBucket }] },
          Aliases: { Quantity: 1, Items: [domainName] },
          DefaultCacheBehavior: {
            TargetOriginId: originIdForPrivateBucket,
            FunctionAssociations: {
              Quantity: 2,
              Items: [
                {
                  FunctionARN: 'function1ARN',
                  EventType: EventType.origin_request,
                },
                {
                  FunctionARN: 'function2ARN',
                  EventType: EventType.viewer_request,
                },
              ],
            },
          },
          CustomErrorResponses: {
            Quantity: 0,
          },
        }

        getDistributionConfigMock.mockReturnValue(
          awsResolve({ DistributionConfig: distribution })
        )

        updateDistribution.mockReturnValueOnce(awsResolve())
        await updateCloudFrontDistribution(distribution.Id, domainName, {
          additionalDomainNames: [],
          cloudFrontFunctionsAssignments: {
            'origin-request': originRequestFunctionNames,
            'origin-response': [],
            'viewer-request': viewerRequestFunctionNames,
            'viewer-response': [],
          },
          shouldBlockBucketPublicAccess: false,
          noDefaultRootObject: withNoDefaultRootObjectFunction,
          oac: null,
          redirect403ToRoot: true,
        })

        expect(updateDistribution).toHaveBeenCalled()
        const expectedFunctions = [
          ...originRequestFunctionNames.map(functionName => ({
            FunctionARN: `${functionName}ARN`,
            EventType: EventType.origin_request,
          })),
          ...viewerRequestFunctionNames.map(functionName => ({
            FunctionARN: `${functionName}ARN`,
            EventType: EventType.viewer_request,
          })),
        ]
        if (withNoDefaultRootObjectFunction) {
          expectedFunctions.push({
            FunctionARN: 'plop',
            EventType: EventType.viewer_request,
          })
        }

        expect(updateDistribution).toHaveBeenCalledWith(
          expect.objectContaining({
            DistributionConfig: expect.objectContaining({
              DefaultCacheBehavior: expect.objectContaining({
                FunctionAssociations: {
                  Quantity:
                    originRequestFunctionNames.length +
                    viewerRequestFunctionNames.length +
                    (withNoDefaultRootObjectFunction ? 1 : 0),
                  Items: expectedFunctions,
                },
              }),
            }),
          })
        )
      }
    )

    it('should update the distribution if additionalDomainNames are provided', async () => {
      const domainName = 'hello.lalilo.com'
      const additionalDomainName1 = 'ola.lalilo.com'
      const additionalDomainName2 = 'hallo.lalilo.com'
      const originIdForPrivateBucket =
        getS3DomainNameForBlockedBucket(domainName)

      const distribution = {
        Id: 'distribution-id',
        Origins: { Items: [{ DomainName: originIdForPrivateBucket }] },
        Aliases: { Quantity: 1, Items: [domainName] },
        DefaultCacheBehavior: {
          TargetOriginId: originIdForPrivateBucket,
        },
        CustomErrorResponses: {
          Quantity: 0,
        },
      }

      getDistributionConfigMock.mockReturnValue(
        awsResolve({ DistributionConfig: distribution })
      )

      updateDistribution.mockReturnValueOnce(awsResolve())
      await updateCloudFrontDistribution(distribution.Id, domainName, {
        additionalDomainNames: [additionalDomainName1, additionalDomainName2],
        cloudFrontFunctionsAssignments: {
          'origin-request': [],
          'origin-response': [],
          'viewer-request': [],
          'viewer-response': [],
        },
        shouldBlockBucketPublicAccess: false,
        noDefaultRootObject: false,
        oac: null,
        redirect403ToRoot: true,
      })

      expect(updateDistribution).toHaveBeenCalled()
      expect(updateDistribution).toHaveBeenCalledWith(
        expect.objectContaining({
          DistributionConfig: expect.objectContaining({
            Aliases: {
              Quantity: 3,
              Items: [domainName, additionalDomainName1, additionalDomainName2],
            },
          }),
        })
      )
    })

    it('should update the distribution if the 403 redirection option was not set in the existing config', async () => {
      const domainName = 'hello.lalilo.com'
      const originIdForPrivateBucket =
        getS3DomainNameForBlockedBucket(domainName)

      const distribution = {
        Id: 'distribution-id',
        Origins: { Items: [{ DomainName: originIdForPrivateBucket }] },
        Aliases: { Quantity: 1, Items: [domainName] },
        DefaultCacheBehavior: {
          TargetOriginId: originIdForPrivateBucket,
        },
        CustomErrorResponses: {
          Quantity: 0,
        },
      }

      getDistributionConfigMock.mockReturnValue(
        awsResolve({ DistributionConfig: distribution })
      )

      updateDistribution.mockReturnValueOnce(awsResolve())
      await updateCloudFrontDistribution(distribution.Id, domainName, {
        additionalDomainNames: [],
        cloudFrontFunctionsAssignments: {
          'origin-request': [],
          'origin-response': [],
          'viewer-request': [],
          'viewer-response': [],
        },
        shouldBlockBucketPublicAccess: false,
        noDefaultRootObject: false,
        oac: null,
        redirect403ToRoot: true,
      })

      expect(updateDistribution).toHaveBeenCalled()
      expect(updateDistribution).toHaveBeenCalledWith(
        expect.objectContaining({
          DistributionConfig: expect.objectContaining({
            CustomErrorResponses: {
              Quantity: 1,
              Items: [
                {
                  ErrorCode: 403,
                  ResponsePagePath: '/index.html',
                  ResponseCode: '200',
                  ErrorCachingMinTTL: 10,
                },
              ],
            },
          }),
        })
      )
    })
    it('should not update the distribution if the 403 redirection option is already set in the existing config', async () => {
      const domainName = 'hello.lalilo.com'
      const originIdForPrivateBucket =
        getS3DomainNameForBlockedBucket(domainName)

      const distribution = {
        Id: 'distribution-id',
        Origins: { Items: [{ DomainName: originIdForPrivateBucket }] },
        Aliases: { Quantity: 1, Items: [domainName] },
        DefaultRootObject: '',
        DefaultCacheBehavior: {
          TargetOriginId: originIdForPrivateBucket,
          FunctionAssociations: {
            Quantity: 1,
            Items: [
              {
                FunctionARN: 'plop',
                EventType: 'viewer-request',
              },
            ],
          },
        },
        CustomErrorResponses: {
          Quantity: 1,
          Items: [
            {
              ErrorCode: 403,
              ResponsePagePath: '/index.html',
              ResponseCode: '200',
              ErrorCachingMinTTL: 10,
            },
          ],
        },
      }

      getDistributionConfigMock.mockReturnValue(
        awsResolve({ DistributionConfig: distribution })
      )

      await updateCloudFrontDistribution(distribution.Id, domainName, {
        additionalDomainNames: [],
        cloudFrontFunctionsAssignments: {
          'origin-request': [],
          'origin-response': [],
          'viewer-request': [],
          'viewer-response': [],
        },
        shouldBlockBucketPublicAccess: true,
        noDefaultRootObject: true,
        oac: {
          originAccessControl: { Id: 'oac-id' },
          ETag: 'etag',
        },
        redirect403ToRoot: true,
      })

      expect(updateDistribution).not.toHaveBeenCalled()
    })
  })
})
