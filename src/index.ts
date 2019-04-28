import * as yargs from "yargs";
import { deploy } from "./deploy";
import { logger } from "./logger";

const argv = yargs
  .usage("$0 [options]", "Deploy a single page app on AWS")
  .option("domainName", {
    type: "string",
    demand: true,
    describe:
      'The domain name on which the SPA will be accessible. For example "app.example.com"'
  })
  .option("directory", {
    type: "string",
    default: "build",
    describe:
      "The directory where the static files have been generated. It must contain an index.html file"
  }).argv;

deploy(argv.domainName, argv.directory)
  .then(() => {
    logger.info("✅ done!");
  })
  .catch(error => {
    logger.error(`💥 ${error.message}`);
  });
