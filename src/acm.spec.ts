import { createCertificate, domainNameMatch, getCertificateARN } from "./acm";
import { acm, route53 } from "./aws-services";
import { awsResolve } from "./test-helper";

jest.mock("inquirer", () => {
  return {
    __esModule: true,
    default: { prompt: jest.fn() },
  };
});

describe("acm", () => {
  describe("getCertificateARN", () => {
    const listCertificatesMock = jest.spyOn(acm, "listCertificates");
    const describeCertificateMock = jest.spyOn(acm, "describeCertificate");
    const waitForMock = jest.spyOn(acm, "waitFor");

    afterEach(() => {
      listCertificatesMock.mockReset();
      describeCertificateMock.mockReset();
      waitForMock.mockReset();
    });

    it("should get the list of certificates (1 page)", async () => {
      listCertificatesMock.mockReturnValue(
        awsResolve({
          CertificateSummaryList: [
            {
              CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
            },
          ],
        })
      );
      describeCertificateMock.mockReturnValue(
        awsResolve({
          Certificate: {
            Status: "ISSUED",
            DomainName: "*.example.com",
            CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
          },
        })
      );
      const arn = await getCertificateARN("hello.example.com");
      expect(arn).toEqual("arn:aws:acm:us-east-1:123456789:certificate/xxx");
      expect(listCertificatesMock).toHaveBeenCalledTimes(1);
    });

    it("should get the list of certificates (2 page)", async () => {
      listCertificatesMock
        .mockReturnValueOnce(
          awsResolve({
            CertificateSummaryList: [
              {
                CertificateArn:
                  "arn:aws:acm:us-east-1:123456789:certificate/xxx",
              },
            ],
            NextToken: "xxx",
          })
        )
        .mockReturnValueOnce(
          awsResolve({
            CertificateSummaryList: [
              {
                CertificateArn:
                  "arn:aws:acm:us-east-1:123456789:certificate/yyy",
              },
            ],
          })
        );
      describeCertificateMock
        .mockReturnValueOnce(
          awsResolve({
            Certificate: {
              Status: "ISSUED",
              DomainName: "hello2.example.com",
              CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
            },
          })
        )
        .mockReturnValueOnce(
          awsResolve({
            Certificate: {
              Status: "ISSUED",
              DomainName: "*.example.com",
              CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/yyy",
            },
          })
        );
      const arn = await getCertificateARN("hello.example.com");
      expect(arn).toEqual("arn:aws:acm:us-east-1:123456789:certificate/yyy");
      expect(listCertificatesMock).toHaveBeenCalledTimes(2);
    });

    it("should check alternative names", async () => {
      listCertificatesMock.mockReturnValue(
        awsResolve({
          CertificateSummaryList: [
            {
              CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
            },
          ],
        })
      );
      describeCertificateMock.mockReturnValue(
        awsResolve({
          Certificate: {
            DomainName: "example.com",
            Status: "ISSUED",
            CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
            SubjectAlternativeNames: ["staging.example.com", "*.example.com"],
          },
        })
      );
      const arn = await getCertificateARN("hello.example.com");
      expect(arn).toEqual("arn:aws:acm:us-east-1:123456789:certificate/xxx");
    });

    it("should ignored non issued or pending certificates", async () => {
      listCertificatesMock.mockReturnValue(
        awsResolve({
          CertificateSummaryList: [
            {
              CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
            },
          ],
        })
      );
      describeCertificateMock.mockReturnValue(
        awsResolve({
          Certificate: {
            DomainName: "*.example.com",
            Status: "REVOKED",
            CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
          },
        })
      );
      const arn = await getCertificateARN("hello.example.com");
      expect(arn).toEqual(null);
    });

    it("should check return null if no certificate is found", async () => {
      listCertificatesMock.mockReturnValue(
        awsResolve({
          CertificateSummaryList: [
            {
              CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
            },
          ],
        })
      );
      describeCertificateMock.mockReturnValue(
        awsResolve({
          Certificate: {
            DomainName: "example.com",
            Status: "ISSUED",
            CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
          },
        })
      );
      const arn = await getCertificateARN("hello.example.com");
      expect(arn).toEqual(null);
    });

    it("should use an ISSUED certificate before a PENDING_VALIDATION certificate", async () => {
      listCertificatesMock.mockReturnValue(
        awsResolve({
          CertificateSummaryList: [
            {
              CertificateArn:
                "arn:aws:acm:us-east-1:123456789:certificate/pending",
            },
            {
              CertificateArn:
                "arn:aws:acm:us-east-1:123456789:certificate/issued",
            },
          ],
        })
      );
      describeCertificateMock
        .mockReturnValueOnce(
          awsResolve({
            Certificate: {
              DomainName: "*.example.com",
              Status: "PENDING_VALIDATION",
              CertificateArn:
                "arn:aws:acm:us-east-1:123456789:certificate/pending",
            },
          })
        )
        .mockReturnValueOnce(
          awsResolve({
            Certificate: {
              DomainName: "hello.example.com",
              Status: "ISSUED",
              CertificateArn:
                "arn:aws:acm:us-east-1:123456789:certificate/issued",
            },
          })
        );
      const arn = await getCertificateARN("hello.example.com");
      expect(arn).toEqual("arn:aws:acm:us-east-1:123456789:certificate/issued");
    });

    it("should waitFor a PENDING_VALIDATION certificate", async () => {
      listCertificatesMock.mockReturnValue(
        awsResolve({
          CertificateSummaryList: [
            {
              CertificateArn:
                "arn:aws:acm:us-east-1:123456789:certificate/pending",
            },
          ],
        })
      );
      describeCertificateMock.mockReturnValue(
        awsResolve({
          Certificate: {
            DomainName: "*.example.com",
            Status: "PENDING_VALIDATION",
            CertificateArn:
              "arn:aws:acm:us-east-1:123456789:certificate/pending",
          },
        })
      );
      waitForMock.mockReturnValue(awsResolve());
      const arn = await getCertificateARN("hello.example.com");
      expect(arn).toEqual(
        "arn:aws:acm:us-east-1:123456789:certificate/pending"
      );
      expect(waitForMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("domainNameMatch", () => {
    it("should handle exact domain name match", () => {
      expect(domainNameMatch("hello.example.com", "hello.example.com")).toEqual(
        true
      );
    });

    it("should handle wildcare domain name match", () => {
      expect(domainNameMatch("*.example.com", "hello.example.com")).toEqual(
        true
      );
    });

    it("should not match different domain name", () => {
      expect(domainNameMatch("*.example.com", "hello.example2.com")).toEqual(
        false
      );
    });

    it("should not match different domain name", () => {
      expect(
        domainNameMatch("hello.example.com", "hello2.example.com")
      ).toEqual(false);
    });
  });

  describe("createCertificate", () => {
    const requestCertificateMock = jest.spyOn(acm, "requestCertificate");
    const waitForMock = jest.spyOn(acm, "waitFor");
    const describeCertificateMock = jest.spyOn(acm, "describeCertificate");
    const changeResourceRecordSetsMock = jest.spyOn(
      route53,
      "changeResourceRecordSets"
    );

    afterEach(() => {
      requestCertificateMock.mockReset();
      waitForMock.mockReset();
      describeCertificateMock.mockReset();
      changeResourceRecordSetsMock.mockReset();
    });

    it("should request a certificate", async () => {
      requestCertificateMock.mockReturnValue(
        awsResolve({
          CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
        })
      );
      describeCertificateMock.mockReturnValue(
        awsResolve({
          Certificate: {
            DomainValidationOptions: [
              {
                DomainName: "hello.example.com",
                ResourceRecord: {
                  Name: "_sOmESTrAnGeChArAcTeRs.example.com",
                  Type: "CNAME",
                  Value: "_sOmESTrAnGeChArAcTeRs",
                },
              },
            ],
          },
        })
      );
      changeResourceRecordSetsMock.mockReturnValue(awsResolve());
      waitForMock.mockReturnValue(awsResolve());
      await createCertificate("hello.example.com", "hostedZoneId", 0);
      expect(requestCertificateMock).toHaveBeenCalledTimes(1);
      const requestCertificateParams: any =
        requestCertificateMock.mock.calls[0][0];
      expect(requestCertificateParams.DomainName).toEqual("hello.example.com");
      expect(requestCertificateParams.ValidationMethod).toEqual("DNS");
      expect(waitForMock).toHaveBeenCalledWith("certificateValidated", {
        CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx",
        $waiter: { delay: 10 },
      });

      expect(changeResourceRecordSetsMock).toHaveBeenCalledTimes(1);
      const changeResourceRecordSetsMockParams: any =
        changeResourceRecordSetsMock.mock.calls[0][0];
      expect(
        changeResourceRecordSetsMockParams.ChangeBatch.Changes[0]
          .ResourceRecordSet.Name
      ).toEqual("_sOmESTrAnGeChArAcTeRs.example.com");
      expect(
        changeResourceRecordSetsMockParams.ChangeBatch.Changes[0]
          .ResourceRecordSet.Type
      ).toEqual("CNAME");
      expect(
        changeResourceRecordSetsMockParams.ChangeBatch.Changes[0]
          .ResourceRecordSet.ResourceRecords[0].Value
      ).toEqual("_sOmESTrAnGeChArAcTeRs");
    });
  });
});
