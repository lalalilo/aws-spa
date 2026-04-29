import { iam } from './aws-services'
import { logger } from './logger'

export const getRoleARNForBasicLambdaExectution = async (
  roleName: string,
  waitAfterCreate: number = 10000
) => {
  try {
    logger.info(`[IAM] 🔍 looking for role ${roleName}...`)
    const { Role } = await iam.getRole({ RoleName: roleName })
    logger.info(`[IAM] 👍 ${roleName} found`)
    return Role?.Arn
  } catch (error: any) {
    if (error.$metadata?.httpStatusCode !== 404) {
      throw error
    }
    logger.info(`[IAM] ✏️ ${roleName} not found. Creating it...`)
    const { Role } = await iam.createRole({
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: ['lambda.amazonaws.com', 'edgelambda.amazonaws.com'],
              },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
        RoleName: roleName,
      })

    await iam.attachRolePolicy({
        PolicyArn:
          'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        RoleName: roleName,
      })

    logger.info(`[IAM] 👍 ${roleName} created`)

    // timeout to avoid "The role defined for the function cannot be assumed by Lambda"
    await new Promise(resolve => setTimeout(resolve, waitAfterCreate))
    return Role?.Arn
  }
}
