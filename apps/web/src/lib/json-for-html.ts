/**
 * Serialize JSON for embedding in an HTML script element.
 *
 * JSON.stringify alone is unsafe here: an attacker-controlled string containing
 * `</script>` terminates the element before the HTML parser considers the script
 * type. Escaping HTML-significant characters keeps the payload valid JSON while
 * preventing it from creating markup.
 */
export function serializeJsonForHtml(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError("Value cannot be serialized as JSON.");
  }

  return json
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
