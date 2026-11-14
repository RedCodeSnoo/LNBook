/** Same rules as the LNReader helper of the same name. */
export function isUrlAbsolute(url: string): boolean {
  if (url) {
    if (url.indexOf('//') === 0) {
      return true;
    }
    if (url.indexOf('://') === -1) {
      return false;
    }
    if (url.indexOf('.') === -1) {
      return false;
    }
    if (url.indexOf('/') === -1) {
      return false;
    }
    if (url.indexOf(':') > url.indexOf('/')) {
      return false;
    }
    if (url.indexOf('://') < url.indexOf('.')) {
      return true;
    }
  }
  return false;
}
