import { getAll } from "./aws-helper";
import { CertificateSummary, ValidationMethod } from "aws-sdk/clients/acm";
import { acm } from "./aws-services";
import { logger } from "./logger";

export const getCertificateARN = async (domainName: string) => {
  let waitFor: null | string = null;

  const certificates = await getAll<CertificateSummary>(
    async (nextMarker, page) => {
      logger.info(
        `Looking for a certificate matching "${domainName}" in zone "us-east-1" (page ${page})...`
      );

      const { CertificateSummaryList, NextToken } = await acm
        .listCertificates({ NextToken: nextMarker })
        .promise();
      return { items: CertificateSummaryList || [], nextMarker: NextToken };
    }
  );

  for (const certificate of certificates) {
    if (!certificate.CertificateArn) {
      continue;
    }

    const { Certificate } = await acm
      .describeCertificate({
        CertificateArn: certificate.CertificateArn
      })
      .promise();

    if (!Certificate) {
      continue;
    }

    if (domainNameMatch(Certificate.DomainName, domainName)) {
      if (Certificate.Status !== "ISSUED") {
        logger.info(
          `Certificate with domain name "${
            Certificate.DomainName
          }" is matching but its status is "${Certificate.Status}"`
        );

        if (Certificate.Status === "PENDING_VALIDATION") {
          waitFor = Certificate.CertificateArn || null;
        }
        continue;
      }
      logger.info(
        `Certificate with domain name "${Certificate.DomainName}" is matching`
      );
      return certificate.CertificateArn as string;
    }

    if (!Certificate.SubjectAlternativeNames) {
      continue;
    }

    for (const alternativeName of Certificate.SubjectAlternativeNames) {
      if (domainNameMatch(alternativeName, domainName)) {
        if (Certificate.Status !== "ISSUED") {
          logger.info(
            `Certificate with alternative name "${alternativeName}" (domain name "${
              Certificate.DomainName
            }") is matching but its status is "${Certificate.Status}"`
          );
          if (Certificate.Status === "PENDING_VALIDATION") {
            waitFor = Certificate.CertificateArn || null;
          }
          continue;
        }
        logger.info(
          `Alternative name "${alternativeName}" of certificate "${
            Certificate.DomainName
          }" is matching`
        );
        return certificate.CertificateArn;
      }
    }
  }

  if (!waitFor) {
    return null;
  }
  await acm.waitFor("certificateValidated", { CertificateArn: waitFor });
  return waitFor;
};

export const createCertificate = async (
  domainName: string,
  validationMethod: ValidationMethod = "EMAIL"
) => {
  logger.info(`Requesting a certificate for "${domainName}"...`);
  const { CertificateArn } = await acm
    .requestCertificate({
      DomainName: domainName,
      ValidationMethod: validationMethod
    })
    .promise();

  if (!CertificateArn) {
    throw new Error("No CertificateArn returned");
  }

  logger.info(
    `Request sent. Waiting for certificate validation: the domain owner of "${domainName}" should have received an email...`
  );
  await acm.waitFor("certificateValidated", { CertificateArn });
  return CertificateArn;
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
