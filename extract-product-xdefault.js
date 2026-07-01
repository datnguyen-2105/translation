const fs = require('fs');
const {
  DEFAULT_CLONE_LANGS,
  LANG_TO_TRANSLATE_CODE,
  translateText,
  translateHtmlContent,
  encodeHtmlEntities,
  initProtectedTerms
} = require('./extract-content-xdefault.js');

function parseAttributes(attrStr) {
  const attrs = {};
  const regex = /([a-zA-Z0-9:-]+)\s*=\s*(['"])([\s\S]*?)\2/g;
  let match;
  while ((match = regex.exec(attrStr)) !== null) {
    attrs[match[1]] = match[3];
  }
  return attrs;
}

function buildAttrStr(lang, otherAttrs) {
  let str = '';
  for (const [key, val] of Object.entries(otherAttrs)) {
    str += ` ${key}="${val}"`;
  }
  str += ` xml:lang="${lang}"`;
  return str;
}

function checkTagExists(productBlock, tagName, lang, otherAttrs) {
  const tagRegex = new RegExp('<' + tagName + '(\\s+[^>]*?)>([\\s\\S]*?)<\\/' + tagName + '>', 'g');
  let match;
  while ((match = tagRegex.exec(productBlock)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (attrs['xml:lang'] === lang) {
      let allMatch = true;
      for (const [k, v] of Object.entries(otherAttrs)) {
        if (attrs[k] !== v) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        return true;
      }
    }
  }
  return false;
}

function updateTagContent(productBlock, tagName, lang, otherAttrs, newContent) {
  const tagRegex = new RegExp('<' + tagName + '(\\s+[^>]*?)>([\\s\\S]*?)<\\/' + tagName + '>', 'g');
  return productBlock.replace(tagRegex, (fullMatch, attrStr, innerContent) => {
    const attrs = parseAttributes(attrStr);
    if (attrs['xml:lang'] === lang) {
      let allMatch = true;
      for (const [k, v] of Object.entries(otherAttrs)) {
        if (attrs[k] !== v) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        return `<${tagName}${attrStr}>${newContent}</${tagName}>`;
      }
    }
    return fullMatch;
  });
}

// Only these tags will be translated; everything else (custom-attributes, etc.) is left as-is
const TRANSLATABLE_TAGS = new Set([
  'display-name',
  'short-description',
  'page-title',
  'page-description'
]);

async function processProductBlock(productBlock, cloneLangs, translationCache) {
  const xDefaultRegex = /<([a-zA-Z0-9:-]+)(\s+[^>]*?xml:lang=["']x-default["'][^>]*?)>([\s\S]*?)<\/([a-zA-Z0-9:-]+)>/g;
  
  let match;
  const xDefaultTags = [];
  
  while ((match = xDefaultRegex.exec(productBlock)) !== null) {
    if (match[1] !== match[4]) continue;
    if (!TRANSLATABLE_TAGS.has(match[1])) continue;
    xDefaultTags.push({
      fullMatch: match[0],
      tagName: match[1],
      attrStr: match[2],
      content: match[3]
    });
  }
  
  for (let i = xDefaultTags.length - 1; i >= 0; i--) {
    const tagInfo = xDefaultTags[i];
    const { tagName, attrStr, content: srcText, fullMatch } = tagInfo;
    
    const otherAttrs = parseAttributes(attrStr);
    delete otherAttrs['xml:lang'];
    
    const newTagsToInsert = [];
    
    // Translate all languages in parallel (semaphore controls API concurrency)
    const langResults = await Promise.all(cloneLangs.map(async (lang) => {
      const translateCode = LANG_TO_TRANSLATE_CODE[lang] || lang;
      
      let translatedContent;
      if (tagName === 'short-description') {
        const rawContent = await translateHtmlContent(srcText, translateCode, translationCache);
        translatedContent = encodeHtmlEntities(rawContent);
      } else {
        translatedContent = await translateText(srcText, translateCode, translationCache);
      }
      
      return { lang, translatedContent };
    }));

    // Apply translations sequentially (since updateTagContent modifies productBlock)
    for (const { lang, translatedContent } of langResults) {
      const targetTagExists = checkTagExists(productBlock, tagName, lang, otherAttrs);
      
      if (targetTagExists) {
        productBlock = updateTagContent(productBlock, tagName, lang, otherAttrs, translatedContent);
      } else {
        const newAttrStr = buildAttrStr(lang, otherAttrs);
        const newTag = `<${tagName}${newAttrStr}>${translatedContent}</${tagName}>`;
        newTagsToInsert.push(newTag);
      }
    }
    
    if (newTagsToInsert.length > 0) {
      const tagIndex = productBlock.lastIndexOf(fullMatch);
      if (tagIndex !== -1) {
        let indent = '';
        let j = tagIndex - 1;
        while (j >= 0 && (productBlock[j] === ' ' || productBlock[j] === '\t')) {
          indent = productBlock[j] + indent;
          j--;
        }
        if (j >= 0 && productBlock[j] === '\n') {
          indent = '\n' + indent;
        } else {
          indent = '';
        }
        
        const separator = indent || '\n';
        const insertionString = newTagsToInsert.map(t => separator + t).join('');
        const insertPos = tagIndex + fullMatch.length;
        productBlock = productBlock.slice(0, insertPos) + insertionString + productBlock.slice(insertPos);
      }
    }
  }
  
  return productBlock;
}

async function processProductTranslation(inputPath, outputPath, options = {}) {
  const cloneLangs = options.cloneLangs || DEFAULT_CLONE_LANGS;
  initProtectedTerms(options.protectedTerms, inputPath);
  
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }
  
  const xml = fs.readFileSync(inputPath, 'utf8');
  const productRegex = /<product\b[\s\S]*?<\/product>/g;
  const productMatches = [];
  let match;
  while ((match = productRegex.exec(xml)) !== null) {
    productMatches.push({
      fullMatch: match[0],
      index: match.index
    });
  }
  
  const translationCache = new Map();
  let lastIdx = 0;
  let resultXml = '';
  
  for (const matchInfo of productMatches) {
    resultXml += xml.slice(lastIdx, matchInfo.index);
    const processedBlock = await processProductBlock(matchInfo.fullMatch, cloneLangs, translationCache);
    resultXml += processedBlock;
    lastIdx = matchInfo.index + matchInfo.fullMatch.length;
  }
  resultXml += xml.slice(lastIdx);
  
  fs.writeFileSync(outputPath, resultXml, 'utf8');
}

module.exports = {
  processProductTranslation
};
