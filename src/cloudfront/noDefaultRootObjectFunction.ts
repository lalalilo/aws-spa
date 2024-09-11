import { NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR } from './constants'

export const noDefaultRootObjectFunctions = {
  [NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR]: `
    async function handler(event) {
      const request = event.request
      const uri = request.uri

      if (uri.endsWith('index.html/') || uri.endsWith('index.html')) {
        return request
      }

      // make sure there is a slash before the hash router's "#/" to avoid "url.com/branch#/path" case
      if (!uri.endsWith('/')) {
        return {
          statusCode: 302,
          statusDescription: 'Found',
          headers: {
            location: {
              value: request.uri + '/',
            },
          },
        }
      }

      request.uri += 'index.html'

      return request
    }
  `
}
