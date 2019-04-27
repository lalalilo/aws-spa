import {
  createBucket,
  identifyingTag,
  setBucketWebsite,
  setBucketPolicy,
  doesS3BucketExists,
  syncToS3,
  indexCacheControl
} from "./s3";
import { s3 } from "./aws-services";
import * as fsHelper from "./fs-helper";
import * as fs from "fs";
import { awsResolve, awsReject } from "./test-helper";
import { logger } from "./logger";

jest.mock("fs");

describe("s3", () => {
  const logSpy = jest.spyOn(logger, "info");
  afterEach(() => {
    logSpy.mockReset();
  });

  describe("createBucket", () => {
    const createBucketSpy = jest.spyOn(s3, "createBucket");
    const putBucketTaggingSpy = jest.spyOn(s3, "putBucketTagging");

    afterEach(() => {
      createBucketSpy.mockReset();
      putBucketTaggingSpy.mockReset();
    });

    it("should exists", () => {
      expect(createBucket).toBeDefined();
    });

    it("should log a creation messages", async () => {
      createBucketSpy.mockReturnValue(awsResolve());
      putBucketTaggingSpy.mockReturnValue(awsResolve());
      await createBucket("some-bucket");
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toContain('[S3] Creating "some-bucket"');
      expect(logSpy.mock.calls[1][0]).toContain("[S3] Add tag");
    });

    it("should call s3.createBucket with bucket name", async () => {
      createBucketSpy.mockReturnValue(awsResolve());
      putBucketTaggingSpy.mockReturnValue(awsResolve());
      await createBucket("some-bucket");
      expect(createBucketSpy).toHaveBeenCalledTimes(1);
      const createBucketParams: any = createBucketSpy.mock.calls[0][0];
      expect(createBucketParams.Bucket).toEqual("some-bucket");
    });

    it("should throw if s3.createBucket throws", async () => {
      createBucketSpy.mockReturnValue(awsReject(400, "some error"));

      try {
        await createBucket("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(putBucketTaggingSpy).toHaveBeenCalledTimes(0);
        expect(error.message).toEqual("some error");
      }
    });

    it("should handle bucket in other region", async () => {
      createBucketSpy.mockReturnValue(awsReject(409));

      try {
        await createBucket("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(putBucketTaggingSpy).toHaveBeenCalledTimes(0);
        expect(error.message).toContain("bucket already exists");
      }
    });

    it("should tag created bucket", async () => {
      createBucketSpy.mockReturnValue(awsResolve());
      putBucketTaggingSpy.mockReturnValue(awsResolve());

      await createBucket("some-bucket");
      expect(putBucketTaggingSpy).toHaveBeenCalledTimes(1);

      const taggingParams: any = putBucketTaggingSpy.mock.calls[0][0];
      expect(taggingParams.Bucket).toEqual("some-bucket");
      expect(taggingParams.Tagging.TagSet[0]).toEqual(identifyingTag);
    });

    it("should throw if s3.putBucketTagging throws", async () => {
      createBucketSpy.mockReturnValue(awsResolve());
      createBucketSpy.mockReturnValue(awsReject(400, "some error"));

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
    });

    it("should log a message", async () => {
      putBucketWebsiteSpy.mockReturnValue(awsResolve());
      await setBucketWebsite("some-bucket");
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain("[S3] Set bucket website");
    });

    it("should set bucket website", async () => {
      putBucketWebsiteSpy.mockReturnValue(awsResolve());

      await setBucketWebsite("some-bucket");
      expect(putBucketWebsiteSpy).toHaveBeenCalledTimes(1);

      const websiteParams: any = putBucketWebsiteSpy.mock.calls[0][0];
      expect(websiteParams.Bucket).toEqual("some-bucket");
    });

    it("should throw if s3.putBucketWebsite throws", async () => {
      putBucketWebsiteSpy.mockReturnValue(awsReject(400, "some error"));

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
    });

    it("should log a message", async () => {
      putBucketPolicySpy.mockReturnValue(awsResolve());
      await setBucketPolicy("some-bucket");
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain("[S3] Allow public read");
    });

    it("should set bucket policy", async () => {
      putBucketPolicySpy.mockReturnValue(awsResolve());

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
      putBucketPolicySpy.mockReturnValue(awsReject(400, "some error"));

      try {
        await setBucketPolicy("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toEqual("some error");
      }
    });
  });

  describe("doesS3BucketExists", () => {
    const headBucketSpy = jest.spyOn(s3, "headBucket");
    const getBucketTaggingSpy = jest.spyOn(s3, "getBucketTagging");

    it("should handle success case", async () => {
      headBucketSpy.mockReturnValue(awsResolve());
      getBucketTaggingSpy.mockReturnValue(
        awsResolve({
          TagSet: [identifyingTag]
        })
      );

      expect(await doesS3BucketExists("some-bucket")).toBe(true);
      expect(logSpy).toBeCalledTimes(3);
      expect(logSpy.mock.calls[0][0]).toContain(
        'Looking for bucket "some-bucket"'
      );
      expect(logSpy.mock.calls[1][0]).toContain("Checking tags");
      expect(logSpy.mock.calls[2][0]).toMatch(/Tag "(.)+:(.)+" found/);
    });

    it("should handle not found bucket", async () => {
      headBucketSpy.mockReturnValue(awsReject(404));

      expect(await doesS3BucketExists("some-bucket")).toBe(false);
      expect(logSpy).toBeCalledTimes(2);
      expect(logSpy.mock.calls[1][0]).toContain(
        'Bucket "some-bucket" not found'
      );
    });

    it("should throw if headBucket throws non 404 error", async () => {
      headBucketSpy.mockReturnValue(awsReject(400, "some message"));

      try {
        await doesS3BucketExists("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toEqual("some message");
      }
    });

    it("should throw if bucket has not been created by aws-spa (no tagging)", async () => {
      headBucketSpy.mockReturnValue(awsResolve());
      getBucketTaggingSpy.mockReturnValue(awsReject(404));

      try {
        await doesS3BucketExists("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toContain(
          'Bucket "some-bucket" does not seem to have been created by aws-spa'
        );
      }
    });

    it("should throw if bucket has not been created by aws-spa (tagging but no identifying tag)", async () => {
      headBucketSpy.mockReturnValue(awsResolve());
      getBucketTaggingSpy.mockReturnValue(
        awsResolve({
          TagSet: [{ Key: "some tag key", Value: "some tag value" }]
        })
      );

      try {
        await doesS3BucketExists("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toContain(
          'Bucket "some-bucket" does not seem to have been created by aws-spa'
        );
      }
    });

    it("should throw if getBucketTagging throws", async () => {
      headBucketSpy.mockReturnValue(awsResolve());
      getBucketTaggingSpy.mockReturnValue(awsReject(400, "some message"));

      try {
        await doesS3BucketExists("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toEqual("some message");
      }
    });
  });

  describe("syncToS3", () => {
    const someFiles = [
      "images/icons/logo.png",
      "index.html",
      "static/1.bbbbbb.css",
      "static/1.bbbbbb.js",
      "static/main.aaaaaa.js"
    ].map(path => `some-folder/${path}`);
    const readRecursivelyMock = jest
      .spyOn(fsHelper, "readRecursively")
      .mockReturnValue(someFiles);
    const putObjectSpy = jest
      .spyOn(s3, "putObject")
      .mockReturnValue(awsResolve());
    const createReadStreamSpy = jest
      .spyOn(fs, "createReadStream")
      .mockImplementation(() => "file content" as any);

    afterEach(() => {
      readRecursivelyMock.mockClear();
      putObjectSpy.mockClear();
      createReadStreamSpy.mockClear();
    });

    it("should call s3.putObject for each file returned by readRecursively", async () => {
      await syncToS3("some-folder", "some-bucket");
      expect(readRecursivelyMock).toHaveBeenCalledWith("some-folder");
      expect(putObjectSpy).toHaveBeenCalledTimes(someFiles.length);
      for (const call of putObjectSpy.mock.calls as any) {
        expect(call[0].Bucket).toEqual("some-bucket");
        expect(call[0].Key).not.toContain("some-folder");
      }
    });

    it("should set the right cache-control", async () => {
      await syncToS3("some-folder", "some-bucket");
      expect(readRecursivelyMock).toHaveBeenCalledWith("some-folder");
      expect(putObjectSpy).toHaveBeenCalledTimes(someFiles.length);

      const putObjectIndex: any = putObjectSpy.mock.calls.find(
        (call: any) => call[0].Key === "index.html"
      );
      expect(putObjectIndex).toBeDefined();
      expect(putObjectIndex[0].CacheControl).toEqual(indexCacheControl);
    });
  });
});
