export function handler(event) {
  const DEFAULT_ROOT_OBJECT_NAME = 'index.html'

  var request = event.request
  var uri = request.uri

  // Get the URL path
  const urlPath = uri.split('.com/')[1]

  // If the URL doesn't have a path, we are in the root of the website, not in a branch specific deployment
  // only add the index.html as if the defaultRootObject was set to index.html
  if (urlPath === '') {
    request.uri += `/${DEFAULT_ROOT_OBJECT_NAME}`
    return request
  }

  // Get the branch name from the URL path (multiple deployments of the app in the same bucket)
  const branch = urlPath.split('/#')[0]

  // Rewrite the URL to the branch specific deployment root object
  let urlWithoutRootObject = uri.split(`/${DEFAULT_ROOT_OBJECT_NAME}`)[0]
  if (!urlWithoutRootObject.endsWith('/')) {
    urlWithoutRootObject += '/'
  }
  request.uri += `${urlWithoutRootObject}${branch}/${DEFAULT_ROOT_OBJECT_NAME}`

  return request
}
