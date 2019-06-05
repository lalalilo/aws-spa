import { cloudfront } from "./aws-services";
import { awsResolve } from "./test-helper";
import {
  findDeployedCloudfrontDistribution,
  invalidateCloudfrontCache,
  identifyingTag,
  createCloudFrontDistribution
} from "./cloudfront";

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

    it("should invalidate index.html", async () => {
      createInvalidationMock.mockReturnValue(awsResolve({ Invalidation: {} }));
      await invalidateCloudfrontCache("some-distribution-id");

      expect(createInvalidationMock).toHaveBeenCalledTimes(1);
      const invalidationParams: any = createInvalidationMock.mock.calls[0][0];
      expect(invalidationParams.DistributionId).toEqual("some-distribution-id");
      expect(invalidationParams.InvalidationBatch.Paths.Items[0]).toEqual(
        "/index.html"
      );
    });

    it("should wait for invalidate if wait flag is true", async () => {
      createInvalidationMock.mockReturnValue(awsResolve({ Invalidation: {} }));
      waitForMock.mockReturnValue(awsResolve());
      await invalidateCloudfrontCache("some-distribution-id", true);
      expect(waitForMock).toHaveBeenCalledTimes(1);
      expect(waitForMock.mock.calls[0][0]).toEqual("invalidationCompleted");
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
});
