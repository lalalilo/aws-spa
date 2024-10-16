export const awsResolve = (value?: any): any => Promise.resolve(value)

export const awsReject = (statusCode: number, message: string = ''): any => Promise.reject({ statusCode, message })
