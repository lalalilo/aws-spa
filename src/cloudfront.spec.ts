import { cloudfront } from "./aws-services";
import { awsReject, awsResolve } from "./test-helper";
import {
  findDeployedCloudfrontDistribution,
  invalidateCloudfrontCache,
  identifyingTag,
  createCloudFrontDistribution,
  setSimpleAuthBehavior,
  getCacheInvalidations,
  invalidateCloudfrontCacheWithRetry
} from "./cloudfront";
import { lambdaPrefix } from "./lambda";

describe("cloudfront", () => {
  describe("findDeployedCloudfrontDistribution", () => {
    const listDistributionMock = jest.spyOn(cloudfront, "listDistributions");
    const listTagsForResourceMock = jest.spyOn(
      cloudfront,
      "listTagsForResource"
    );
    const waitForMock = jest.spyOn(cloudfront, "waitFor");

    afterEach(() => {
      listDistributionMock.mockReset();
      listTagsForResourceMock.mockReset();
      waitForMock.mockReset();
    });

    it("should return the distribution even if on page 2", async () => {
      listDistributionMock
        .mockReturnValueOnce(
          awsResolve({
            DistributionList: {
              NextMarker: "xxx",
              Items: [
                {
                  Id: "GOODBYE",
                  Aliases: {
                    Items: ["goodbye.example.com"]
                  }
                }
              ]
            }
          })
        )
        .mockReturnValueOnce(
          awsResolve({
            DistributionList: {
              Items: [
                {
                  Id: "HELLO",
                  Status: "Deployed",
                  Aliases: {
                    Items: ["hello.example.com"]
                  }
                }
              ]
            }
          })
        );

      listTagsForResourceMock.mockReturnValue(
        awsResolve({
          Tags: {
            Items: [identifyingTag]
          }
        })
      );

      const distribution: any = await findDeployedCloudfrontDistribution(
        "hello.example.com"
      );
      expect(distribution).toBeDefined();
      expect(distribution.Id).toEqual("HELLO");
    });

    it("should wait for distribution if distribution is not deployed", async () => {
      listDistributionMock.mockReturnValue(
        awsResolve({
          DistributionList: {
            Items: [
              {
                Id: "HELLO",
                Status: "In Progress",
                Aliases: {
                  Items: ["hello.example.com"]
                }
              }
            ]
          }
        })
      );

      listTagsForResourceMock.mockReturnValue(
        awsResolve({
          Tags: {
            Items: [identifyingTag]
          }
        })
      );
      waitForMock.mockReturnValue(awsResolve());

      await findDeployedCloudfrontDistribution("hello.example.com");
      expect(waitForMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("invalidateCloudfrontCache", () => {
    const createInvalidationMock = jest.spyOn(cloudfront, "createInvalidation");
    const waitForMock = jest.spyOn(cloudfront, "waitFor");

    afterEach(() => {
      createInvalidationMock.mockReset();
      waitForMock.mockReset();
    });

    it("should invalidate the specified path", async () => {
      createInvalidationMock.mockReturnValue(awsResolve({ Invalidation: {} }));
      await invalidateCloudfrontCache("some-distribution-id", "index.html");

      expect(createInvalidationMock).toHaveBeenCalledTimes(1);
      const invalidationParams: any = createInvalidationMock.mock.calls[0][0];
      expect(invalidationParams.DistributionId).toEqual("some-distribution-id");
      expect(invalidationParams.InvalidationBatch.Paths.Items[0]).toEqual(
        "index.html"
      );
    });

    it("should invalidate the specified paths", async () => {
      createInvalidationMock.mockReturnValue(awsResolve({ Invalidation: {} }));
      await invalidateCloudfrontCache(
        "some-distribution-id",
        "index.html, static/*"
      );

      expect(createInvalidationMock).toHaveBeenCalledTimes(1);
      const invalidationParams: any = createInvalidationMock.mock.calls[0][0];
      expect(invalidationParams.DistributionId).toEqual("some-distribution-id");
      expect(invalidationParams.InvalidationBatch.Paths.Items).toEqual([
        "index.html",
        "static/*"
      ]);
    });

    it("should wait for invalidate if wait flag is true", async () => {
      createInvalidationMock.mockReturnValue(awsResolve({ Invalidation: {} }));
      waitForMock.mockReturnValue(awsResolve());
      await invalidateCloudfrontCache(
        "some-distribution-id",
        "index.html",
        true
      );
      expect(waitForMock).toHaveBeenCalledTimes(1);
      expect(waitForMock.mock.calls[0][0]).toEqual("invalidationCompleted");
    });
  });

  describe("invalidateCloudfrontCacheWithRetry", () => {
    const createInvalidationMock = jest.spyOn(cloudfront, "createInvalidation");
    const waitForMock = jest.spyOn(cloudfront, "waitFor");

    afterEach(() => {
      createInvalidationMock.mockReset();
      waitForMock.mockReset();
    });
    it("should retry once", async () => {
      createInvalidationMock
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsResolve({ Invalidation: {} }));

      await invalidateCloudfrontCacheWithRetry(
        "some-distribution-id",
        "index.html, static/*"
      );

      expect(createInvalidationMock).toHaveBeenCalledTimes(2);
    });

    it("should retry 5 times at most", async () => {
      createInvalidationMock
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsReject(1))
        .mockReturnValueOnce(awsResolve({ Invalidation: {} }));

      try {
        await invalidateCloudfrontCacheWithRetry(
          "some-distribution-id",
          "index.html, static/*"
        );
      } catch (error) {
        expect(error).toBeDefined();
      }

      expect(createInvalidationMock).toHaveBeenCalledTimes(5);
    });
  });

  describe("createCloudFrontDistribution", () => {
    const createDistributionMock = jest.spyOn(cloudfront, "createDistribution");
    const waitForMock = jest.spyOn(cloudfront, "waitFor");
    const tagResourceMock = jest.spyOn(cloudfront, "tagResource");

    afterEach(() => {
      createDistributionMock.mockReset();
      waitForMock.mockReset();
      tagResourceMock.mockReset();
    });

    it("should create a distribution and wait for it to be available", async () => {
      const distribution = { Id: "distribution-id" };
      createDistributionMock.mockReturnValue(
        awsResolve({ Distribution: distribution })
      );
      tagResourceMock.mockReturnValue(awsResolve());
      waitForMock.mockReturnValue(awsResolve());
      const result = await createCloudFrontDistribution(
        "hello.lalilo.com",
        "arn:certificate"
      );
      expect(result).toBe(distribution);
      expect(tagResourceMock).toHaveBeenCalledTimes(1);
      expect(createDistributionMock).toHaveBeenCalledTimes(1);
      const distributionParam: any = createDistributionMock.mock.calls[0][0];
      const distributionConfig = distributionParam.DistributionConfig;
      expect(distributionConfig.Origins.Items[0].DomainName).toEqual(
        "hello.lalilo.com.s3-website.eu-west-3.amazonaws.com"
      );
      expect(
        distributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy
      ).toEqual("redirect-to-https");
      expect(distributionConfig.DefaultCacheBehavior.MinTTL).toEqual(0);
      expect(distributionConfig.DefaultCacheBehavior.Compress).toEqual(true);
      expect(distributionConfig.ViewerCertificate.ACMCertificateArn).toEqual(
        "arn:certificate"
      );

      expect(waitForMock).toHaveBeenCalledTimes(1);
      expect(waitForMock).toHaveBeenCalledWith("distributionDeployed", {
        Id: "distribution-id"
      });
    });
  });

  describe("setSimpleAuthBehavior", () => {
    const getDistributionConfig = jest.spyOn(
      cloudfront,
      "getDistributionConfig"
    );
    const updateDistribution = jest.spyOn(cloudfront, "updateDistribution");

    beforeEach(() => {
      getDistributionConfig.mockReset();
      updateDistribution.mockReset();
    });

    it("should not update if there is no lambda association & no credentials", async () => {
      getDistributionConfig.mockReturnValueOnce(
        awsResolve({
          DistributionConfig: {
            DefaultCacheBehavior: {
              LambdaFunctionAssociations: {
                Items: []
              }
            }
          },
          ETag: ""
        })
      );
      await setSimpleAuthBehavior("distribution-id", null);
      expect(updateDistribution).not.toHaveBeenCalled();
    });

    it("should remove lambda association if lambda is set but no credential is set", async () => {
      getDistributionConfig.mockReturnValueOnce(
        awsResolve({
          DistributionConfig: {
            DefaultCacheBehavior: {
              LambdaFunctionAssociations: {
                Items: [{ LambdaFunctionARN: `some-arn:${lambdaPrefix}:1` }]
              }
            }
          },
          ETag: ""
        })
      );
      updateDistribution.mockReturnValueOnce(awsResolve());
      await setSimpleAuthBehavior("distribution-id", null);
      expect(updateDistribution).toHaveBeenCalledTimes(1);
      expect(
        (updateDistribution.mock.calls[0][0] as any).DistributionConfig
          .DefaultCacheBehavior.LambdaFunctionAssociations.Items
      ).toEqual([]);
    });

    it("should not update if there is a lambda association & credentials", async () => {
      getDistributionConfig.mockReturnValueOnce(
        awsResolve({
          DistributionConfig: {
            DefaultCacheBehavior: {
              LambdaFunctionAssociations: {
                Items: [{ LambdaFunctionARN: `some-arn:${lambdaPrefix}:1` }]
              }
            }
          },
          ETag: ""
        })
      );
      await setSimpleAuthBehavior(
        "distribution-id",
        `some-arn:${lambdaPrefix}:1`
      );
      expect(updateDistribution).not.toHaveBeenCalled();
    });

    it("should add lambda association if lambda is not set set but credentials are set", async () => {
      getDistributionConfig.mockReturnValueOnce(
        awsResolve({
          DistributionConfig: {
            DefaultCacheBehavior: {
              LambdaFunctionAssociations: {
                Items: []
              }
            }
          },
          ETag: ""
        })
      );
      updateDistribution.mockReturnValueOnce(awsResolve());
      await setSimpleAuthBehavior("distribution-id", "some-arn:1");
      expect(updateDistribution).toHaveBeenCalledTimes(1);
      expect(
        (updateDistribution.mock.calls[0][0] as any).DistributionConfig
          .DefaultCacheBehavior.LambdaFunctionAssociations.Items
      ).toEqual([
        {
          EventType: "viewer-request",
          IncludeBody: false,
          LambdaFunctionARN: "some-arn:1"
        }
      ]);
    });
  });

  describe("getCacheInvalidations", () => {
    it.each([
      { input: "index.html", expectedOutput: "/index.html" },
      { input: "/index.html", expectedOutput: "/index.html" },
      {
        input: "index.html, hello.html",
        subFolder: undefined,
        expectedOutput: "/index.html,/hello.html"
      },
      {
        input: "index.html",
        subFolder: "some-branch",
        expectedOutput: "/some-branch/index.html"
      }
    ])("add missing slash", ({ input, subFolder, expectedOutput }) => {
      expect(getCacheInvalidations(input, subFolder)).toEqual(expectedOutput);
    });
  });
});
