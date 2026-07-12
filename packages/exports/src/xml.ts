/**
 * Escape a string for use in XML text nodes and attribute values. All five
 * XML metacharacters are replaced, so repository-derived text can never open
 * or close elements in generated JATS/Atom documents.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
