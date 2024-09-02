# How to update the cloudfront function used to deploy staging branches
- copy the function code in noDefaultRootObjectFunction_<current_color>.js to noDefaultRootObjectFunction_<new_color>.js file
- update the code as needed
- update the color in `cloudfront/index.ts` - `NO_DEFAULT_ROOT_OBJECT_REDIRECTION_COLOR` with the new color
