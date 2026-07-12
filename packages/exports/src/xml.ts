/**
 * Escape a string for use in XML text nodes and attribute values. All five
 * XML metacharacters are replaced and characters illegal in XML 1.0 (control
 * characters other than tab/LF/CR, lone surrogates, U+FFFE/U+FFFF) are
 * dropped, so repository-derived text can never open or close elements or
 * render a generated JATS/Atom document not well-formed.
 */
const XML_ILLEGAL =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXml(value: string): string {
  return value
    .replace(XML_ILLEGAL, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
