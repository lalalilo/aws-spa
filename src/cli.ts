#!/usr/bin/env node

import * as yargs from "yargs";
import { deploy } from "./deploy";
import { logger } from "./logger";

yargs
  .command(
    "deploy <domainName>",
    "Deploy a single page app on AWS",
    (yargs) => {
      return yargs
        .positional("domainName", {
          type: "string",
          demand: true,
          describe: `The domain name on which the SPA will be accessible. For example "app.example.com".

          You can also specify a path: "app.example.com/something". This can be useful to deploy multiple versions of the app in the same s3 bucket. For example one could deploy a feature branch of the SPA like this:

          aws-spa deploy app.example.com/$(git branch | grep \* | cut -d ' ' -f2)`,
        })
        .option("wait", {
          type: "boolean",
          default: false,
          describe:
            "Wait for CloudFront distribution to be deployed & cache invalidation to be completed",
        })
        .option("directory", {
          type: "string",
          default: "build",
          describe:
            "The directory where the static files have been generated. It must contain an index.html file",
        })
        .option("cacheInvalidation", {
          type: "string",
          default: "/*",
          describe:
            "The paths to invalidate on CloudFront. Default is all (/*). You can specify several paths comma separated.",
        })
        .option("cacheBustedPrefix", {
          type: "string",
          describe: "A folder where files use cache busting strategy.",
        })
        .option("credentials", {
          type: "string",
          describe:
            'This option enables basic auth for the full s3 bucket (even if the domainName specifies a path). Credentials must be of the form "username:password". Basic auth is the recommended way to avoid search engine indexation of non-production apps (such as staging)',
        })
        .option("noPrompt", {
          type: "boolean",
          default: false,
          describe:
            "Disable confirm message that prompts on non CI environments (env CI=true)",
        });
    },
    async (argv) => {
      if (!argv.domainName) {
        throw new Error("domainName must be provided");
      }
      try {
        await deploy(
          argv.domainName,
          argv.directory,
          argv.wait,
          argv.cacheInvalidation,
          argv.cacheBustedPrefix,
          argv.credentials || process.env.AWS_SPA_CREDENTIALS,
          argv.noPrompt
        );
        logger.info("✅ done!");
        process.exit(0);
      } catch (error: any) {
        logger.error(`💥 ${error.message}`);
        process.exit(1);
      }
    }
  )
  .demandCommand()
  .help().argv;
