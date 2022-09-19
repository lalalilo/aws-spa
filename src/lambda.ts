import AdmZip from "adm-zip";
import { lambda } from "./aws-services";
import { getRoleARNForBasicLambdaExectution } from "./iam";
import { logger } from "./logger";

export const lambdaPrefix = `aws-spa-basic-auth-`;

export const deploySimpleAuthLambda = async (
  domainName: string,
  credentials: string
) => {
  const name = `${lambdaPrefix}${domainName.replace(/\./g, "-")}`;

  if (!(await doesFunctionExists(name))) {
    const roleARN = await getRoleARNForBasicLambdaExectution(name);

    logger.info(`[Lambda] ✏️ Creating lambda function...`);
    await lambda
      .createFunction({
        Code: {
          ZipFile: getZippedCode(credentials),
        },
        FunctionName: name,
        Handler: "simple-auth.handler",
        Role: roleARN,
        Runtime: "nodejs14.x",
        Description: getDescription(credentials),
        Publish: true,
      })
      .promise();
    logger.info(`[Lambda] 👍 lambda created`);
  }

  logger.info(`[Lambda] 🔍 Checking if credentials changed...`);
  const { FunctionArn, Description, Version } = await lambda
    .getFunctionConfiguration({ FunctionName: name })
    .promise();

  if (Description && Description === getDescription(credentials)) {
    logger.info(`[Lambda] 👍 credentials didn't changed. Everything is fine.`);
    return `${FunctionArn}:${Version === "$LATEST" ? "1" : Version}`;
  }

  logger.info(`[Lambda] ✏️ Credentials changed. Updating code...`);
  const { Version: newVersion } = await lambda
    .updateFunctionCode({
      FunctionName: name,
      ZipFile: getZippedCode(credentials),
      Publish: true,
    })
    .promise();
  await lambda
    .updateFunctionConfiguration({
      FunctionName: name,
      Description: getDescription(credentials),
    })
    .promise();

  logger.info(`[Lambda] 👍 Code updated`);
  return `${FunctionArn}:${newVersion}`;
};

const doesFunctionExists = async (functionName: string) => {
  try {
    logger.info(`[Lambda] 🔍 Searching lambda function "${functionName}"...`);

    await lambda
      .getFunction({
        FunctionName: functionName,
      })
      .promise();

    logger.info(`[Lambda] 👍 lambda function found`);
    return true;
  } catch (error: any) {
    if (error.statusCode === 404) {
      logger.info(`[Lambda] 😬 No lambda found`);
      return false;
    }
    throw error;
  }
};

export const getDescription = (credentials: string) =>
  `Deployed by aws-spa to handle simple auth [credentials=${credentials}]`;

const getZippedCode = (credentials: string) => {
  const zip = new AdmZip();
  zip.addFile("simple-auth.js", Buffer.from(getLambdaCode(credentials)));

  return zip.toBuffer();
};

// lambda@edge does not allow to use env variables :-/
const getLambdaCode = (credentials: string) => `
exports.handler = (event, context, callback) => {
  const request = event.Records[0].cf.request;
  const headers = request.headers;

  const authString =
    "Basic " + new Buffer("${credentials}").toString("base64");

  if (
    typeof headers.authorization == "undefined" ||
    headers.authorization[0].value != authString
  ) {
    const body = "Unauthorized";
    const response = {
      status: "401",
      statusDescription: "Unauthorized",
      body: body,
      headers: {
        "www-authenticate": [{ key: "WWW-Authenticate", value: "Basic" }]
      }
    };
    callback(null, response);
  }

  callback(null, request);
};
`;
