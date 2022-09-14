import { prompt } from "inquirer";
import { logger } from "./logger";

export const predeployPrompt = async (ciEnv: boolean, noPrompt: boolean) => {
  if (ciEnv || noPrompt) {
    return;
  }

  logger.info(
    `💡 If you don\'t want this message to prompt, either set CI=true in your env variables or use the "--noPrompt" option.`
  );

  const { continueDeploy } = await prompt([
    {
      type: "confirm",
      name: "continueDeploy",
      message:
        "⚠️  It looks like you're attempting to deploy from a non CI environment. Are you sure you built the SPA correctly (env variables, run tests, ...)?\n\n",
      default: false,
    },
  ]);

  if (!continueDeploy) {
    throw new Error("👍 deploy aborted");
  }
};
