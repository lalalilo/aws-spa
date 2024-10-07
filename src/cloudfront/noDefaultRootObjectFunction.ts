import { NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR } from './constants'

export const noDefaultRootObjectFunctions = {
  [NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR]: `
    async function handler(event) {
      const request = event.request
      const uri = request.uri

      if (uri.endsWith('index.html/') || uri.endsWith('index.html')) {
        return request
      }

      const splitURI = uri.split('/')
      const isNotAnAsset = !splitURI[splitURI.length - 1].includes('.')
      const isOnlyBranchName = splitURI.length === 1
      const hasNoSlashAtTheEnd = !uri.endsWith('/')
      
      // make sure there is a slash before the hash router's "#/" to avoid "url.com/branch#/path" case
      if (isOnlyBranchName && hasNoSlashAtTheEnd && isNotAnAsset) {
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
      
      // add index.html if the URI is not an asset
      if (isNotAnAsset) {
        request.uri += 'index.html'
      }

      return request
    }
  `
}
