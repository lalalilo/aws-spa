export const awsResolve = (value?: any): any => ({
  promise: () => Promise.resolve(value),
})

export const awsReject = (statusCode: number, message: string = ''): any => ({
  promise: () => Promise.reject({ statusCode, message }),
})
