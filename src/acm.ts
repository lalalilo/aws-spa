import { getAll } from "./aws-helper";
import { CertificateSummary, ResourceRecord } from "aws-sdk/clients/acm";
import { acm } from "./aws-services";
import { logger } from "./logger";
import { HostedZone } from "aws-sdk/clients/route53";
import { createCertificateValidationDNSRecord } from "./route53";

export const getCertificateARN = async (domainName: string) => {
  let waitFor: null | string = null;

  const certificates = await getAll<CertificateSummary>(
    async (nextMarker, page) => {
      logger.info(
        `[ACM] 🔍 Looking for a certificate matching "${domainName}" in zone "us-east-1" (page ${page})...`
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
          `[ACM] 👍 Certificate with domain name "${
            Certificate.DomainName
          }" is matching but its status is "${Certificate.Status}"`
        );

        if (Certificate.Status === "PENDING_VALIDATION") {
          waitFor = Certificate.CertificateArn || null;
        }
        continue;
      }
      logger.info(
        `[ACM] 👍 Certificate with domain name "${
          Certificate.DomainName
        }" is matching`
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
            `[ACM] 👍 Certificate with alternative name "${alternativeName}" (domain name "${
              Certificate.DomainName
            }") is matching but its status is "${Certificate.Status}"`
          );
          if (Certificate.Status === "PENDING_VALIDATION") {
            waitFor = Certificate.CertificateArn || null;
          }
          continue;
        }
        logger.info(
          `[ACM] 👍 Alternative name "${alternativeName}" of certificate "${
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

  logger.info(
    `[ACM] ⏱ Waiting for certificate validation: the domain owner of "${domainName}" should have received an email...`
  );
  await acm
    .waitFor("certificateValidated", { CertificateArn: waitFor })
    .promise();
  return waitFor;
};

export const createCertificate = async (
  domainName: string,
  hostedZoneId: string,
  delay?: number
) => {
  logger.info(`[ACM] ✏️ Requesting a certificate for "${domainName}"...`);
  const { CertificateArn } = await acm
    .requestCertificate({
      DomainName: domainName,
      ValidationMethod: "DNS"
    })
    .promise();

  if (!CertificateArn) {
    throw new Error("No CertificateArn returned");
  }

  await handleDNSValidation(CertificateArn, domainName, hostedZoneId, delay);
  return CertificateArn;
};

const handleDNSValidation = async (
  certificateARN: string,
  domainName: string,
  hostedZoneId: string,
  delay: number = 5000
) => {
  // https://github.com/aws/aws-sdk-js/issues/2133
  await new Promise(resolve => setTimeout(resolve, delay));

  const { Certificate } = await acm
    .describeCertificate({ CertificateArn: certificateARN })
    .promise();
  if (!Certificate || !Certificate.DomainValidationOptions) {
    throw new Error("Could not access domain validation options");
  }

  const domainValidationOption = Certificate.DomainValidationOptions.find(
    ({ DomainName, ResourceRecord }) =>
      DomainName === domainName && Boolean(ResourceRecord)
  );
  if (!domainValidationOption) {
    throw new Error(
      `Could not find domain validation options for "${domainName}" with DNS validation`
    );
  }

  await createCertificateValidationDNSRecord(
    domainValidationOption.ResourceRecord as ResourceRecord,
    hostedZoneId
  );
  logger.info(
    `[ACM] ⏱ Request sent. Waiting for certificate validation by DNS`
  );
  await acm
    .waitFor("certificateValidated", {
      CertificateArn: certificateARN,
      $waiter: { delay: 10 }
    })
    .promise();
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
