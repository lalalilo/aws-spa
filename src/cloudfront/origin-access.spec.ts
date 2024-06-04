import { cloudfront } from "../aws-services";
import { awsResolve } from "../test-helper";
import {
  getOriginAccessControlName,
  upsertOriginAccessControl,
} from "./origin-access";

describe("upsertOriginAccessControl", () => {
  const listOriginAccessControlsMock = jest.spyOn(
    cloudfront,
    "listOriginAccessControls",
  );

  const getOriginAccessControlMock = jest.spyOn(
    cloudfront,
    "getOriginAccessControl",
  );
  const createOriginAccessControlMock = jest.spyOn(
    cloudfront,
    "createOriginAccessControl",
  );

  beforeEach(() => {
    listOriginAccessControlsMock.mockReset();
    getOriginAccessControlMock.mockReset();
    createOriginAccessControlMock.mockReset();
  });

  it("does not create OAC if already existing", async () => {
    const domainName = "my-domain";
    const distributionId = "my-distribution-id";
    const oacName = getOriginAccessControlName(domainName, distributionId);

    listOriginAccessControlsMock.mockReturnValue(
      awsResolve({
        OriginAccessControlList: {
          Items: [
            {
              Id: "dummy",
              Name: oacName,
            },
          ],
        },
      }),
    );

    getOriginAccessControlMock.mockReturnValue(
      awsResolve({ OriginAccessControl: {}, ETag: "my-etag" }),
    );

    await upsertOriginAccessControl(domainName, distributionId);

    expect(createOriginAccessControlMock).not.toHaveBeenCalled();
  });

  it("creates OAC if necessary and required (shouldBlockBucketPublicAccess is true)", async () => {
    const domainName = "my-domain";
    const distributionId = "my-distribution-id";
    const oacName = getOriginAccessControlName(domainName, distributionId);

    listOriginAccessControlsMock.mockReturnValue(
      awsResolve({
        OriginAccessControlList: {},
      }),
    );
    createOriginAccessControlMock.mockReturnValue(awsResolve({}));
    await upsertOriginAccessControl(domainName, distributionId);

    expect(listOriginAccessControlsMock).toHaveBeenCalled();
    expect(createOriginAccessControlMock).toHaveBeenCalledTimes(1);
    expect(createOriginAccessControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        OriginAccessControlConfig: {
          Name: oacName,
          OriginAccessControlOriginType: "s3",
          SigningBehavior: "always",
          SigningProtocol: "sigv4",
          Description: `OAC used by ${domainName} associated to distributionId: ${distributionId}`,
        },
      }),
    );
  });
});
