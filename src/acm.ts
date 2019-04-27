import { getAll } from "./aws-helper";
import { CertificateSummary } from "aws-sdk/clients/acm";
import { acm } from "./aws-services";
import { logger } from "./logger";

export const getCertificateARN = async (domainName: string) => {
  const certificates = await getAll<CertificateSummary>(
    async (nextMarker, page) => {
      logger.info(
        `Looking for a certificate matching "${domainName}" (page ${page})...`
      );

      const { CertificateSummaryList, NextToken } = await acm
        .listCertificates({ NextToken: nextMarker })
        .promise();
      return { items: CertificateSummaryList || [], nextMarker: NextToken };
    }
  );

  for (const certificate of certificates) {
    if (domainNameMatch(certificate.DomainName, domainName)) {
      logger.info(`Domain name ${certificate.DomainName} is matching`);
      return certificate.CertificateArn as string;
    }
  }

  logger.info(
    `No certificate found with domain name matching "${domainName}". Falling back on alternative names...`
  );

  for (const certificate of certificates) {
    if (!certificate.CertificateArn) {
      continue;
    }
    const details = await acm
      .describeCertificate({
        CertificateArn: certificate.CertificateArn
      })
      .promise();

    if (
      !details ||
      !details.Certificate ||
      !details.Certificate.SubjectAlternativeNames
    ) {
      continue;
    }
    for (const alternativeName of details.Certificate.SubjectAlternativeNames) {
      if (domainNameMatch(alternativeName, domainName)) {
        logger.info(
          `Alternative name "${alternativeName}" of certificate "${
            certificate.DomainName
          }" is matching`
        );
        return certificate.CertificateArn;
      }
    }
  }

  return null;
};

export const domainNameMatch = (
  certificateDomainName: string = "",
  domainName: string
) =>
  [
    `*.${domainName
      .split(".")
      .slice(1)
      .join(".")}`,
    domainName
  ].includes(certificateDomainName);
