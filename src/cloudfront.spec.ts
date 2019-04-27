import { cloudfront } from "./aws-services";
import { awsResolve } from "./test-helper";
import { findCloudfrontDistribution, clearCloudfrontCache } from "./cloudfront";

describe("cloudfront", () => {
  describe("findDistribution", () => {
    const listDistributionMock = jest.spyOn(cloudfront, "listDistributions");

    afterEach(() => {
      listDistributionMock.mockReset();
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

      const distribution: any = await findCloudfrontDistribution(
        "hello.example.com"
      );
      expect(distribution).toBeDefined();
      expect(distribution.Id).toEqual("HELLO");
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
});
