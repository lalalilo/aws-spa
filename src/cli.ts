#!/usr/bin/env node

import { EventType } from '@aws-sdk/client-cloudfront'
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
        .option('redirect403ToRoot', {
          type: 'boolean',
          default: false,
          describe: `Redirect 403 errors to the root of the SPA.

          This is useful if you want to use client-side routing with an S3 static website without using a hash router.`,
        })
        .option('objectExpirationDays', {
          type: 'number',
          default: undefined,
          describe: `Add a lifecycle configuration to the bucket that clean object after X days.

          This should be a valid, positive number. (ex: --objectExpirationDays 60).`,
          coerce: arg => {
            if (arg === undefined || arg === null) {
              return null
            }

            const numValue = Number(arg)
            if (isNaN(numValue) || numValue <= 0) {
              throw new Error(
                'objectExpirationDays must be a valid positive number'
              )
            }

            return numValue
          },
        })
        .option('originRequestFunctionNames', {
          type: 'array',
          default: [],
          describe: `The names of CloudFront functions that will be associated with the distribution as Origin_Request
          Use it like this: --originRequestFunctionNames function1 function2

          This is useful when you want to assign a function defined in Terraform on a CloudFront distribution deployed for a SPA`,
        })
        .option('originResponseFunctionNames', {
          type: 'array',
          default: [],
          describe: `The names of CloudFront functions that will be associated with the distribution as Origin_Response
          Use it like this: --originResponseFunctionNames function1 function2

          This is useful when you want to assign a function defined in Terraform on a CloudFront distribution deployed for a SPA`,
        })
        .option('viewerRequestFunctionNames', {
          type: 'array',
          default: [],
          describe: `The names of CloudFront functions that will be associated with the distribution as Viewer_Request
          Use it like this: --viewerRequestFunctionNames function1 function2

          This is useful when you want to assign a function defined in Terraform on a CloudFront distribution deployed for a SPA`,
        })
        .option('viewerResponseFunctionNames', {
          type: 'array',
          default: [],
          describe: `The names of CloudFront functions that will be associated with the distribution as Viewer_Response
          Use it like this: --viewerResponseFunctionNames function1 function2

          This is useful when you want to assign a function defined in Terraform on a CloudFront distribution deployed for a SPA`,
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
          argv.noDefaultRootObject,
          argv.redirect403ToRoot,
          argv.objectExpirationDays,
          {
            [EventType.origin_request]: argv.originRequestFunctionNames,
            [EventType.origin_response]: argv.originResponseFunctionNames,
            [EventType.viewer_request]: argv.viewerRequestFunctionNames,
            [EventType.viewer_response]: argv.viewerResponseFunctionNames,
          }
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
