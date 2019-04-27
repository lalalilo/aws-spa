import { domainNameMatch, getCertificateARN } from "./acm";
import { acm } from "./aws-services";
import { awsResolve } from "./test-helper";

describe("acm", () => {
  describe("getCertificateARN", () => {
    const listCertificatesMock = jest.spyOn(acm, "listCertificates");
    const describeCertificateMock = jest.spyOn(acm, "describeCertificate");

    afterEach(() => {
      listCertificatesMock.mockReset();
      describeCertificateMock.mockReset();
    });

    it("should get the list of certificates (1 page)", async () => {
      listCertificatesMock.mockReturnValue(
        awsResolve({
          CertificateSummaryList: [
            {
              DomainName: "*.example.com",
              CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx"
            }
          ]
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
                DomainName: "hello2.example.com",
                CertificateArn:
                  "arn:aws:acm:us-east-1:123456789:certificate/xxx"
              }
            ],
            NextToken: "xxx"
          })
        )
        .mockReturnValueOnce(
          awsResolve({
            CertificateSummaryList: [
              {
                DomainName: "*.example.com",
                CertificateArn:
                  "arn:aws:acm:us-east-1:123456789:certificate/yyy"
              }
            ]
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
              DomainName: "example.com",
              CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx"
            }
          ]
        })
      );
      describeCertificateMock.mockReturnValue(
        awsResolve({
          Certificate: {
            SubjectAlternativeNames: ["staging.example.com", "*.example.com"]
          }
        })
      );
      const arn = await getCertificateARN("hello.example.com");
      expect(arn).toEqual("arn:aws:acm:us-east-1:123456789:certificate/xxx");
      expect(describeCertificateMock).toHaveBeenCalledTimes(1);
      expect(describeCertificateMock).toHaveBeenCalledWith({
        CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx"
      });
    });

    it("should check return null if no certificate is found", async () => {
      listCertificatesMock.mockReturnValue(
        awsResolve({
          CertificateSummaryList: [
            {
              DomainName: "example.com",
              CertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/xxx"
            }
          ]
        })
      );
      describeCertificateMock.mockReturnValue(
        awsResolve({
          Certificate: {
            SubjectAlternativeNames: ["staging.example.com"]
          }
        })
      );
      const arn = await getCertificateARN("hello.example.com");
      expect(arn).toEqual(null);
      expect(describeCertificateMock).toHaveBeenCalledTimes(1);
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
});
