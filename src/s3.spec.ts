import {
  createBucket,
  identifyingTag,
  setBucketWebsite,
  setBucketPolicy,
  doesS3BucketExists,
  syncToS3,
  indexCacheControl,
  confirmBucketManagement,
  tagBucket
} from "./s3";
import { s3 } from "./aws-services";
import * as fsHelper from "./fs-helper";
import * as fs from "fs";
import * as inquirer from "inquirer";
import { awsResolve, awsReject } from "./test-helper";
import { logger } from "./logger";

jest.mock("fs");
jest.mock("inquirer");

describe("s3", () => {
  const logSpy = jest.spyOn(logger, "info");
  afterEach(() => {
    logSpy.mockReset();
  });

  describe("createBucket", () => {
    const createBucketSpy = jest.spyOn(s3, "createBucket");

    afterEach(() => {
      createBucketSpy.mockReset();
    });

    it("should log a creation messages", async () => {
      createBucketSpy.mockReturnValue(awsResolve());
      await createBucket("some-bucket");
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain('Creating "some-bucket"');
    });

    it("should call s3.createBucket with bucket name", async () => {
      createBucketSpy.mockReturnValue(awsResolve());
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
        expect(error.message).toEqual("some error");
      }
    });

    it("should handle bucket in other region", async () => {
      createBucketSpy.mockReturnValue(awsReject(409));

      try {
        await createBucket("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toContain("bucket already exists");
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
      expect(logSpy.mock.calls[0][0]).toContain("Set bucket website");
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
      expect(logSpy.mock.calls[0][0]).toContain("Allow public read");
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

  describe("tagBucket", () => {
    const putBucketTaggingMock = jest.spyOn(s3, "putBucketTagging");

    afterEach(() => {
      putBucketTaggingMock.mockReset();
    });

    it("should log a message", async () => {
      putBucketTaggingMock.mockReturnValue(awsResolve());
      await tagBucket("some-bucket");
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain('Tagging "some-bucket"');
    });

    it("should tag", async () => {
      putBucketTaggingMock.mockReturnValue(awsResolve());

      await tagBucket("some-bucket");
      expect(putBucketTaggingMock).toHaveBeenCalledTimes(1);

      const taggingParams: any = putBucketTaggingMock.mock.calls[0][0];
      expect(taggingParams.Bucket).toEqual("some-bucket");
      expect(taggingParams.Tagging.TagSet.length).toEqual(1);
      expect(taggingParams.Tagging.TagSet[0]).toEqual(identifyingTag);
    });

    it("should throw if s3.putBucketTagging throws", async () => {
      putBucketTaggingMock.mockReturnValue(awsReject(400, "some error"));

      try {
        await tagBucket("some-bucket");
        throw new Error("This test should have failed");
      } catch (error) {
        expect(error.message).toEqual("some error");
      }
    });
  });

  describe("doesS3BucketExists", () => {
    const headBucketSpy = jest.spyOn(s3, "headBucket");

    it("should handle success case", async () => {
      headBucketSpy.mockReturnValue(awsResolve());

      expect(await doesS3BucketExists("some-bucket")).toBe(true);
      expect(logSpy).toBeCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toContain(
        'Looking for bucket "some-bucket"'
      );
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
  });

  describe("confirmBucketManagement", () => {
    const getBucketTaggingMock = jest.spyOn(s3, "getBucketTagging");
    const promptMock = jest.spyOn(inquirer, "prompt");

    afterEach(() => {
      getBucketTaggingMock.mockReset();
      promptMock.mockReset();
    });

    it("should not prompt if bucket is tagged by aws-spa", async () => {
      getBucketTaggingMock.mockReturnValue(
        awsResolve({ TagSet: [identifyingTag] })
      );
      expect(await confirmBucketManagement("some bucket")).toEqual(true);
      expect(getBucketTaggingMock.mock.calls.length).toEqual(1);
      const getTaggingParams: any = getBucketTaggingMock.mock.calls[0][0];
      expect(getTaggingParams.Bucket).toEqual("some bucket");
      expect(promptMock).not.toHaveBeenCalled();
    });

    it("should prompt if bucket has tag but no tag from aws-spa", async () => {
      getBucketTaggingMock.mockReturnValue(awsResolve({ TagSet: [] }));
      promptMock.mockResolvedValue({ continueUpdate: true });
      expect(await confirmBucketManagement("some bucket")).toEqual(true);
      expect(promptMock).toHaveBeenCalled();
    });

    it("should prompt if bucket has no tag", async () => {
      getBucketTaggingMock.mockReturnValue(awsReject(404));
      promptMock.mockResolvedValue({ continueUpdate: true });
      expect(await confirmBucketManagement("some bucket")).toEqual(true);
      expect(promptMock).toHaveBeenCalled();
    });

    it("should throw if fetch tag throwed", async () => {
      getBucketTaggingMock.mockReturnValue(
        awsReject(400, "fetch tagging error")
      );
      try {
        await confirmBucketManagement("some bucket");
        throw new Error("this test should have failed");
      } catch (error) {
        expect(error.message).toEqual("fetch tagging error");
      }
    });

    it("should throw if aws-spa management is refused", async () => {
      getBucketTaggingMock.mockReturnValue(awsResolve({ TagSet: [] }));
      promptMock.mockResolvedValue({ continueUpdate: false });
      try {
        await confirmBucketManagement("some bucket");
        throw new Error("this test should have failed");
      } catch (error) {
        expect(error.message).not.toEqual("this test should have failed");
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
