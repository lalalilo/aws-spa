import { deploySimpleAuthLambda, getDescription } from './lambda'
import * as iam from './iam'
import { lambda } from './aws-services'
import { awsReject, awsResolve } from './test-helper'

describe('lambda', () => {
  jest
    .spyOn(iam, 'getRoleARNForBasicLambdaExectution')
    .mockResolvedValue('arn-value')

  describe('deploySimpleAuthLambda()', () => {
    const getFunction = jest.spyOn(lambda, 'getFunction')
    const getFunctionConfiguration = jest.spyOn(
      lambda,
      'getFunctionConfiguration'
    )
    const createFunction = jest.spyOn(lambda, 'createFunction')
    const updateFunctionCode = jest.spyOn(lambda, 'updateFunctionCode')
    const updateFunctionConfiguration = jest.spyOn(
      lambda,
      'updateFunctionConfiguration'
    )

    beforeEach(() => {
      getFunction.mockReset()
      getFunctionConfiguration.mockReset()
      createFunction.mockReset()
      updateFunctionCode.mockReset()
    })

    it("should return the function ARN & version when function exists & credentials didn't change", async () => {
      getFunction.mockReturnValueOnce(awsResolve())
      getFunctionConfiguration.mockReturnValueOnce(
        awsResolve({
          FunctionArn: 'some-arn',
          Description: getDescription('hello:hello'),
          Version: '1',
        })
      )
      expect(
        await deploySimpleAuthLambda('hello.example.com', 'hello:hello')
      ).toEqual('some-arn:1')
    })

    it('should create a lambda if function is not found', async () => {
      getFunction.mockReturnValueOnce(awsReject(404))
      getFunctionConfiguration.mockReturnValueOnce(
        awsResolve({
          FunctionArn: 'some-arn',
          Description: getDescription('hello:hello'),
          Version: '1',
        })
      )
      createFunction.mockReturnValueOnce(awsResolve())
      await deploySimpleAuthLambda('hello.example.com', 'hello:hello')
      expect(createFunction).toHaveBeenCalledTimes(1)
      expect((createFunction.mock.calls[0][0] as any).FunctionName).toEqual(
        'aws-spa-basic-auth-hello-example-com'
      )
    })

    it('should update code if credentials changed', async () => {
      getFunction.mockReturnValueOnce(awsResolve())
      getFunctionConfiguration.mockReturnValueOnce(
        awsResolve({
          FunctionArn: 'some-arn',
          Description: getDescription('hello:hello'),
          Version: '1',
        })
      )
      createFunction.mockReturnValueOnce(awsResolve())
      updateFunctionCode.mockReturnValueOnce(awsResolve({ Version: '2' }))
      updateFunctionConfiguration.mockReturnValueOnce(awsResolve())

      await deploySimpleAuthLambda('hello.example.com', 'new:credentials')

      expect(updateFunctionCode).toHaveBeenCalledTimes(1)
      expect((updateFunctionCode.mock.calls[0][0] as any).FunctionName).toEqual(
        'aws-spa-basic-auth-hello-example-com'
      )
      expect(updateFunctionConfiguration).toHaveBeenCalledTimes(1)
      expect(
        (updateFunctionConfiguration.mock.calls[0][0] as any).FunctionName
      ).toEqual('aws-spa-basic-auth-hello-example-com')
      expect(
        (updateFunctionConfiguration.mock.calls[0][0] as any).Description
      ).toEqual(getDescription('new:credentials'))
    })
  })
})
