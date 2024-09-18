#!/usr/bin/env node

import * as yargs from 'yargs'
import { deploy } from './deploy'
import { logger } from './logger'

yargs
  .command(
    'deploy <domainName>',
    'Deploy a single page app on AWS',
    yargs => {
      return yargs
        .positional('domainName', {
          type: 'string',
          demand: true,
          describe: `The domain name on which the SPA will be accessible. For example "app.example.com".

          You can also specify a path: "app.example.com/something". This can be useful to deploy multiple versions of the app in the same s3 bucket. For example one could deploy a feature branch of the SPA like this:

          aws-spa deploy app.example.com/$(git branch | grep \* | cut -d ' ' -f2)`,
        })
        .option('wait', {
          type: 'boolean',
          default: false,
          describe:
            'Wait for CloudFront distribution to be deployed & cache invalidation to be completed',
        })
        .option('directory', {
          type: 'string',
          default: 'build',
          describe:
            'The directory where the static files have been generated. It must contain an index.html file',
        })
        .option('cacheInvalidation', {
          type: 'string',
          default: '/*',
          describe:
            'The paths to invalidate on CloudFront. Default is all (/*). You can specify several paths comma separated.',
        })
        .option('cacheBustedPrefix', {
          type: 'string',
          describe: 'A folder where files use cache busting strategy.',
        })
        .option('noPrompt', {
          type: 'boolean',
          default: false,
          describe:
            'Disable confirm message that prompts on non CI environments (env CI=true)',
        })
        .option('shouldBlockBucketPublicAccess', {
          type: 'boolean',
          default: false,
          describe: `Use a REST API endpoint as the origin, and restrict access with an OAC".
 
          This is useful if you want to keep your bucket private. This would not work for multiple versions hosted in the same s3 bucket.`,
        })
        .option('noDefaultRootObject', {
          type: 'boolean',
          default: false,
          describe: `Don't set the default route object to index.html. 
          
          This is useful if you want to host multiple versions of the app in the same s3 bucket.`,
        })
    },
    async argv => {
      if (!argv.domainName) {
        throw new Error('domainName must be provided')
      }
      try {
        await deploy(
          argv.domainName,
          argv.directory,
          argv.wait,
          argv.cacheInvalidation,
          argv.cacheBustedPrefix,
          argv.noPrompt,
          argv.shouldBlockBucketPublicAccess,
          argv.noDefaultRootObject
        )
        logger.info('✅ done!')
        process.exit(0)
      } catch (error: any) {
        logger.error(`💥 ${error.message}`)
        process.exit(1)
      }
    }
  )
  .demandCommand()
  .help().argv
