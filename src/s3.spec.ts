import { syncToS3 } from "./s3";

describe("s3", () => {
  describe("syncToS3", () => {
    it("should exists", () => {
      expect(syncToS3).toBeDefined();
    });
  });
});
