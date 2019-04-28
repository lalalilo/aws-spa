#!/usr/bin/env node

import * as yargs from "yargs";
import { deploy } from "./deploy";
import { logger } from "./logger";

yargs
  .command(
    "deploy <domainName>",
    "Deploy a single page app on AWS",
    yargs => {
      return yargs
        .positional("domainName", {
          type: "string",
          demand: true,
          describe:
            'The domain name on which the SPA will be accessible. For example "app.example.com"'
        })
        .option("wait", {
          type: "boolean",
          default: false,
          describe:
            "Wait for CloudFront distribution to be deployed & cache invalidation to be completed"
        })
        .option("directory", {
          type: "string",
          default: "build",
          describe:
            "The directory where the static files have been generated. It must contain an index.html file"
        });
    },
    async argv => {
      if (!argv.domainName) {
        throw new Error("domainName must be provided");
      }
      try {
        await deploy(argv.domainName, argv.directory, argv.wait);
        logger.info("✅ done!");
      } catch (error) {
        logger.error(`💥 ${error.message}`);
      }
    }
  )
  .demandCommand()
  .help().argv;
