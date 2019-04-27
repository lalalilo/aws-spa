import { cloudfront } from "./aws-services";
import { awsResolve } from "./test-helper";
import {
  findCloudfrontDistribution,
  clearCloudfrontCache,
  identifyingTag,
  createCloudFrontDistribution
} from "./cloudfront";

describe("cloudfront", () => {
  describe("findDistribution", () => {
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
                  Origins: {
                    Items: [
                      {
                        Id: `S3-Website-goodbye.example.com.s3-website.eu-west-3.amazonaws.com`
                      }
                    ]
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
                  Origins: {
                    Items: [
                      {
                        Id: `S3-Website-hello.example.com.s3-website.eu-west-3.amazonaws.com`
                      }
                    ]
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

      const distribution: any = await findCloudfrontDistribution(
        "hello.example.com"
      );
      expect(distribution).toBeDefined();
      expect(distribution.Id).toEqual("HELLO");
    });

    it("should for distribution if distribution is not deployed", async () => {
      listDistributionMock.mockReturnValue(
        awsResolve({
          DistributionList: {
            Items: [
              {
                Id: "HELLO",
                Status: "In Progress",
                Origins: {
                  Items: [
                    {
                      Id: `S3-Website-hello.example.com.s3-website.eu-west-3.amazonaws.com`
                    }
                  ]
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

      await findCloudfrontDistribution("hello.example.com");
      expect(waitForMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("clearCloudfrontCache", () => {
    const createInvalidationMock = jest.spyOn(cloudfront, "createInvalidation");

    afterEach(() => {
      createInvalidationMock.mockReset();
    });

    it("should invalidate index.html", async () => {
      createInvalidationMock.mockReturnValue(awsResolve({ Invalidation: {} }));
      await clearCloudfrontCache("some-distribution-id");

      expect(createInvalidationMock).toHaveBeenCalledTimes(1);
      const invalidationParams: any = createInvalidationMock.mock.calls[0][0];
      expect(invalidationParams.DistributionId).toEqual("some-distribution-id");
      expect(invalidationParams.InvalidationBatch.Paths.Items[0]).toEqual(
        "/index.html"
      );
    });
  });

  describe("createCloudFrontDistribution", () => {
    const createDistributionWithTagsMock = jest.spyOn(
      cloudfront,
      "createDistributionWithTags"
    );

    afterEach(() => {
      createDistributionWithTagsMock.mockReset();
    });

    it("should create a distribution and wait for it to be available", async () => {
      const distribution = {};
      createDistributionWithTagsMock.mockReturnValue(
        awsResolve({ Distribution: distribution })
      );
      const result = await createCloudFrontDistribution(
        "hello.lalilo.com",
        "arn:certificate"
      );
      expect(result).toBe(distribution);
      expect(createDistributionWithTagsMock).toHaveBeenCalledTimes(1);
      const distributionParam: any =
        createDistributionWithTagsMock.mock.calls[0][0];
      const distributionConfig =
        distributionParam.DistributionConfigWithTags.DistributionConfig;
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
    });
  });
});
