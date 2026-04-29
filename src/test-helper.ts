export const awsResolve = (value?: any): any => Promise.resolve(value)

export const awsReject = (
  httpStatusCode: number,
  name: string = 'UnknownError'
): any => Promise.reject({ name, message: name, $metadata: { httpStatusCode } })
