import { iam } from './aws-services'
import { getRoleARNForBasicLambdaExectution } from './iam'
import { awsReject, awsResolve } from './test-helper'

describe('IAM', () => {
  const getRole = jest.spyOn(iam, 'getRole')
  const createRole = jest.spyOn(iam, 'createRole')
  const attachRolePolicy = jest.spyOn(iam, 'attachRolePolicy')

  beforeEach(() => {
    getRole.mockReset()
    createRole.mockReset()
    attachRolePolicy.mockReset()
  })

  describe('getRoleARNForBasicLambdaExectution', () => {
    it('should return the role ARN if role is found', async () => {
      getRole.mockReturnValueOnce(awsResolve({ Role: { Arn: 'some-ARN' } }))
      expect(await getRoleARNForBasicLambdaExectution('some-role')).toEqual(
        'some-ARN'
      )
    })

    it('should throw if error is not 404', async () => {
      expect.assertions(1)
      getRole.mockReturnValueOnce(awsReject(400, 'some message'))
      try {
        await getRoleARNForBasicLambdaExectution('some-role')
      } catch (error: any) {
        expect(error.message).toEqual('some message')
      }
    })

    it('should create the role if role is not found', async () => {
      getRole.mockReturnValueOnce(awsReject(404))
      createRole.mockReturnValueOnce(awsResolve({ Role: { Arn: 'new-arn' } }))
      attachRolePolicy.mockReturnValueOnce(awsResolve())

      expect(await getRoleARNForBasicLambdaExectution('some-role', 0)).toEqual(
        'new-arn'
      )

      expect(createRole).toHaveBeenCalledTimes(1)
      expect((createRole.mock.calls[0][0] as any).RoleName).toEqual('some-role')
      expect(attachRolePolicy).toHaveBeenCalledTimes(1)
      expect((attachRolePolicy.mock.calls[0][0] as any).RoleName).toEqual(
        'some-role'
      )
    })
  })
})
