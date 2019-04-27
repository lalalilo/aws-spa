export const s3 = {
  createBucket: jest.fn(),
  putBucketTagging: jest.fn(),
  putBucketWebsite: jest.fn(),
  putBucketPolicy: jest.fn(),
  headBucket: jest.fn(),
  getBucketTagging: jest.fn()
};
