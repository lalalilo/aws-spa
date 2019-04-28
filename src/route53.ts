import { route53 } from "./aws-services";
import { logger } from "./logger";
import { getAll } from "./aws-helper";
import { HostedZone } from "aws-sdk/clients/route53";

export const findHostedZone = async (domainName: string) => {
  logger.info(
    `[route53] 🔍 Looking for a hosted zone matching "${domainName}"...`
  );

  const hostedZones = await getAll<HostedZone>(async (nextMarker, page) => {
    logger.info(`[route53] 🔍 List hosted zones (page ${page})...`);
    const { HostedZones, NextMarker } = await route53
      .listHostedZones({ Marker: nextMarker })
      .promise();
    return { items: HostedZones, nextMarker: NextMarker };
  });

  const matchingHostedZones = hostedZones.filter(hostedZone =>
    domainName.endsWith(hostedZone.Name.replace(/\.$/g, ""))
  );

  if (matchingHostedZones.length === 1) {
    logger.info(
      `[route53] 👍 Found Hosted zone: "${matchingHostedZones[0].Name}"`
    );
    return matchingHostedZones[0];
  }

  if (matchingHostedZones.length > 1) {
    logger.warn(
      `[route53] ⚠️ Found multiple hosted zones: ${matchingHostedZones
        .map(hostedZone => `"${hostedZone.Name}"`)
        .join(
          ", "
        )}. There first hosted zone will be used. If this is an issue, please open an issue on https://github.com/nicgirault/aws-spa/issues`
    );
    return matchingHostedZones[0];
  }

  logger.info(`[route53] 🧐 No hosted zone found`);
  return null;
};

export const createHostedZone = async (domainName: string) => {
  logger.info(`[route53] ✏️ Creating hosted zone "${domainName}"...`);
  const { HostedZone } = await route53
    .createHostedZone({
      Name: domainName,
      CallerReference: `aws-spa-${Date.now()}`
    })
    .promise();

  return HostedZone;
};

export const updateRecord = async (
  hostedZoneId: string,
  domainName: string,
  cloudfrontDomainName: string
) => {
  logger.info(
    `[route53] ✏️ Upserting CNAME: "${domainName}." → ${cloudfrontDomainName}...`
  );
  await route53
    .changeResourceRecordSets({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: `${domainName}.`,
              Type: "CNAME",
              TTL: 3600,
              ResourceRecords: [{ Value: `${cloudfrontDomainName}.` }]
            }
          }
        ]
      }
    })
    .promise();
};
