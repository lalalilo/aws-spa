import {
  createBucket,
  identifyingTag,
  setBucketWebsite,
  setBucketPolicy
} from "./s3";
import { s3 } from "./aws-services";

jest.mock("./aws-services");
const resolve: any = {
  promise: () => Promise.resolve()
};
const reject = (statusCode: number, message: string = ""): any => ({
  promise: () => Promise.reject({ statusCode, message })
});

describe("s3", () => {
  const logSpy = jest.spyOn(console, "log");

  describe("createBucket", () => {
    const createBucketSpy = jest.spyOn(s3, "createBucket");
    const putBucketTaggingSpy = jest.spyOn(s3, "putBucketTagging");

    afterEach(() => {
      createBucketSpy.mockReset();
      putBucketTaggingSpy.mockReset();
      logSpy.mockReset();
    });

    it("should exists", () => {
      expect(createBucket).toBeDefined();
    });

    it("should log a creation messages", async () => {
      createBucketSpy.mockReturnValue(resolve);
      putBucketTaggingSpy.mockReturnValue(resolve);
      await createBucket("some-bucket");
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toContain('[S3] Creating "some-bucket"');
      expect(logSpy.mock.calls[1][0]).toContain("[S3] Add tag");
    });

    it("should call s3.createBucket with bucket name", async () => {
      createBucketSpy.mockReturnValue(resolve);
      putBucketTaggingSpy.mockReturnValue(resolve);
      await createBucket("some-bucket");
      expect(createBucketSpy).toHaveBeenCalledTimes(1);
      const createBucketParams: any = createBucketSpy.mock.calls[0][0];
      expect(createBucketParams.Bucket).toEqual("some-bucket");
    });

    it("should throw if s3.createBucket throws", async () => {
      createBucketSpy.mockReturnValue(reject(400, "some error"));

      try {
        await createBucket("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(putBucketTaggingSpy).toHaveBeenCalledTimes(0);
        expect(error.message).toEqual("some error");
      }
    });

    it("should handle bucket in other region", async () => {
      createBucketSpy.mockReturnValue(reject(409));

      try {
        await createBucket("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(putBucketTaggingSpy).toHaveBeenCalledTimes(0);
        expect(error.message).toContain("bucket already exists");
      }
    });

    it("should tag created bucket", async () => {
      createBucketSpy.mockReturnValue(resolve);
      putBucketTaggingSpy.mockReturnValue(resolve);

      await createBucket("some-bucket");
      expect(putBucketTaggingSpy).toHaveBeenCalledTimes(1);

      const taggingParams: any = putBucketTaggingSpy.mock.calls[0][0];
      expect(taggingParams.Bucket).toEqual("some-bucket");
      expect(taggingParams.Tagging.TagSet[0]).toEqual(identifyingTag);
    });

    it("should throw if s3.putBucketTagging throws", async () => {
      createBucketSpy.mockReturnValue(resolve);
      createBucketSpy.mockReturnValue(reject(400, "some error"));

      try {
        await createBucket("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toEqual("some error");
      }
    });
  });

  describe("setBucketWebsite", () => {
    const putBucketWebsiteSpy = jest.spyOn(s3, "putBucketWebsite");

    afterEach(() => {
      putBucketWebsiteSpy.mockReset();
      logSpy.mockReset();
    });

    it("should log a message", async () => {
      putBucketWebsiteSpy.mockReturnValue(resolve);
      await setBucketWebsite("some-bucket");
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain("[S3] Set bucket website");
    });

    it("should set bucket website", async () => {
      putBucketWebsiteSpy.mockReturnValue(resolve);

      await setBucketWebsite("some-bucket");
      expect(putBucketWebsiteSpy).toHaveBeenCalledTimes(1);

      const websiteParams: any = putBucketWebsiteSpy.mock.calls[0][0];
      expect(websiteParams.Bucket).toEqual("some-bucket");
    });

    it("should throw if s3.putBucketWebsite throws", async () => {
      putBucketWebsiteSpy.mockReturnValue(reject(400, "some error"));

      try {
        await setBucketWebsite("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toEqual("some error");
      }
    });
  });

  describe("setBucketPolicy", () => {
    const putBucketPolicySpy = jest.spyOn(s3, "putBucketPolicy");

    afterEach(() => {
      putBucketPolicySpy.mockReset();
      logSpy.mockReset();
    });

    it("should log a message", async () => {
      putBucketPolicySpy.mockReturnValue(resolve);
      await setBucketPolicy("some-bucket");
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain("[S3] Allow public read");
    });

    it("should set bucket policy", async () => {
      putBucketPolicySpy.mockReturnValue(resolve);

      await setBucketPolicy("some-bucket");
      expect(putBucketPolicySpy).toHaveBeenCalledTimes(1);

      const policyParams: any = putBucketPolicySpy.mock.calls[0][0];
      const statement = JSON.parse(policyParams.Policy).Statement[0];
      expect(policyParams.Bucket).toEqual("some-bucket");
      expect(statement.Sid).toEqual("AllowPublicRead");
      expect(statement.Effect).toEqual("Allow");
      expect(statement.Principal.AWS).toEqual("*");
      expect(statement.Action).toEqual("s3:GetObject");
      expect(statement.Resource).toEqual("arn:aws:s3:::some-bucket/*");
    });

    it("should throw if s3.putBucketWebsite throws", async () => {
      putBucketPolicySpy.mockReturnValue(reject(400, "some error"));

      try {
        await setBucketPolicy("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toEqual("some error");
      }
    });
  });
});
