// A small DOM helper. Text always goes in with textContent, never as HTML.

/**
 * Create an element with a class and, optionally, text.
 *
 * :param doc: The document.
 * :param tag: The tag name.
 * :param className: The class attribute, or "".
 * :param text: Text content, or undefined for none.
 * :return: The element.
 */
export function el(doc, tag, className = "", text = undefined) {
  const node = doc.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}
