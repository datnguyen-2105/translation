/**
 * merge-xml.js
 * Merges multiple translated XML files into a single XML document.
 * Supports both Product Section (<catalog>) and Page Designer (<library>) formats.
 */

/**
 * Merges multiple Product Section XML strings into one.
 * Takes the XML declaration, <catalog> wrapper, and <header> from the first file,
 * then collects all <product> blocks from every file.
 *
 * @param {string[]} xmlStrings - Array of translated XML strings
 * @returns {string} - Single merged XML string
 */
function mergeProductXml(xmlStrings) {
  if (!xmlStrings || xmlStrings.length === 0) {
    throw new Error('No XML content to merge.');
  }

  if (xmlStrings.length === 1) {
    return xmlStrings[0];
  }

  const first = xmlStrings[0];

  // Extract the XML declaration
  const xmlDeclMatch = first.match(/<\?xml[^?]*\?>/);
  const xmlDecl = xmlDeclMatch ? xmlDeclMatch[0] : '<?xml version="1.0" encoding="UTF-8"?>';

  // Extract the <catalog> opening tag (with namespace and catalog-id)
  const catalogOpenMatch = first.match(/<catalog\b[^>]*>/);
  if (!catalogOpenMatch) {
    throw new Error('Could not find <catalog> root element in the first file.');
  }
  const catalogOpen = catalogOpenMatch[0];

  // Extract the <header> block from the first file
  const headerMatch = first.match(/<header>[\s\S]*?<\/header>/);
  const headerBlock = headerMatch ? headerMatch[0] : '';

  // Collect all <product> blocks from every file
  const allProducts = [];
  for (let i = 0; i < xmlStrings.length; i++) {
    const xml = xmlStrings[i];
    const productRegex = /(\s*<product\b[\s\S]*?<\/product>)/g;
    let match;
    while ((match = productRegex.exec(xml)) !== null) {
      allProducts.push(match[1]);
    }
  }

  if (allProducts.length === 0) {
    throw new Error('No <product> elements found in any of the uploaded files.');
  }

  // Reconstruct merged XML
  const indent = '    ';
  let merged = xmlDecl + '\n';
  merged += catalogOpen + '\n';

  if (headerBlock) {
    merged += indent + headerBlock + '\n';
  }

  merged += '\n';
  merged += allProducts.join('\n\n');
  merged += '\n\n</catalog>\n';

  return merged;
}

/**
 * Merges multiple Page Designer XML strings into one.
 * Takes the XML declaration and <library> wrapper from the first file,
 * then collects all <content> blocks from every file.
 *
 * @param {string[]} xmlStrings - Array of translated XML strings
 * @returns {string} - Single merged XML string
 */
function mergeLibraryXml(xmlStrings) {
  if (!xmlStrings || xmlStrings.length === 0) {
    throw new Error('No XML content to merge.');
  }

  if (xmlStrings.length === 1) {
    return xmlStrings[0];
  }

  const first = xmlStrings[0];

  // Extract the XML declaration
  const xmlDeclMatch = first.match(/<\?xml[^?]*\?>/);
  const xmlDecl = xmlDeclMatch ? xmlDeclMatch[0] : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  // Extract the <library> opening tag (with namespace and library-id)
  const libraryOpenMatch = first.match(/<library\b[^>]*>/);
  if (!libraryOpenMatch) {
    throw new Error('Could not find <library> root element in the first file.');
  }
  const libraryOpen = libraryOpenMatch[0];

  // Collect all <content> blocks from every file
  const allContents = [];
  for (let i = 0; i < xmlStrings.length; i++) {
    const xml = xmlStrings[i];
    // <content> blocks can be deeply nested, match from <content content-id="..."> to </content>
    const contentRegex = /(\s*<content\b[\s\S]*?<\/content>)/g;
    let match;
    while ((match = contentRegex.exec(xml)) !== null) {
      allContents.push(match[1]);
    }
  }

  if (allContents.length === 0) {
    throw new Error('No <content> elements found in any of the uploaded files.');
  }

  // Reconstruct merged XML
  let merged = xmlDecl + '\n';
  merged += libraryOpen + '\n';
  merged += allContents.join('\n');
  merged += '\n</library>\n';

  return merged;
}

module.exports = {
  mergeProductXml,
  mergeLibraryXml
};
