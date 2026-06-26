#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const DEFAULT_INPUT_PATH = process.argv[2] || path.join(__dirname, '..', 'thermal-excellence.xml');
const DEFAULT_OUTPUT_PATH = process.argv[3] || path.join(__dirname, '..', 'thermal-excellence.xdefault-cloned.xml');
var PROTECTED_TERMS = (process.env.PROTECTED_TERMS || 'Computex,Freeform,Cooler Master,Thermal Mastery,One Cooler Master,Thermal Excellence')
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);
const DEFAULT_CLONE_LANGS = ['de-DE', 'fr-FR', 'it-IT', 'nl-NL', 'es', 'id-ID', 'ja-JP', 'ko-KR', 'pt-BR', 'th-TH', 'vi-VN'];
const TRANSLATABLE_FIELDS = new Set([
  'html_content',
  'richText',
  'description',
  'title',
  'title_xl',
  'label',
  'title_l',
  'description',
  'bodyMarkup',
  'headline',
  'title_m',
  'title_s',
  'pretitle',
  'cta',
  'secondaryButtonTitle',
  'primaryButtonTitle'
]);
const LANG_TO_TRANSLATE_CODE = {
  es: 'es',
  'id-ID': 'id',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'pt-BR': 'pt',
  'th-TH': 'th',
  'vi-VN': 'vi',
  'zh-TW': 'zh-TW'
};
let TRANSLATION_MISSES = 0;
const SKIP_TYPES = new Set(
  [
    'component.commerce_layouts.cmblock2col',
    'component.commerce_layouts.cmblock1col',
    'component.commerce_layouts.cmblock3col',
    'component.commerce_layouts.mobileGrid1r1c',
    'component.commerce_layouts.cmBoxLayout',
    'component.commerce_assets.photoTile',
    'component.commerce_assets.cmContactForm',
    'component.commerce_layouts.cmCustomGrid',
    'component.commerce_assets.cmGridCard',
    'component.commerce_layouts.cmblockcolumnslider'
  ].map((type) => normalizeType(type))
);

function normalizeType(typeValue) {
  return String(typeValue || '').trim().toLowerCase();
}

function indentBlock(block, spaces) {
  return block
    .split('\n')
    .map((line) => `${' '.repeat(spaces)}${line}`)
    .join('\n');
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeHtmlEntities(input) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function protectTerms(input) {
  let protectedText = input;
  const tokenMap = [];

  PROTECTED_TERMS.forEach((term, index) => {
    const token = `[[CM_TERM_${index}]]`;
    const regex = new RegExp(escapeRegExp(term), 'g');
    if (regex.test(protectedText)) {
      protectedText = protectedText.replace(regex, token);
      tokenMap.push({ token, term });
    }
  });

  return { text: protectedText, tokenMap };
}

function protectCodeLikeTokens(input) {
  let protectedText = input;
  const tokenMap = [];
  let index = 0;

  const patterns = [
    /\b[a-z]+(?:[A-Z][A-Za-z0-9]*)+\b/g, // camelCase like userReferer
    /\b[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b/g // c-referrer, last_external_referrer
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(input)) !== null) {
      const tokenValue = match[0];
      if (!tokenValue) {
        continue;
      }

      const token = `ZXPROTECTCODE${index}ZX`;
      const escapedValue = escapeRegExp(tokenValue);
      protectedText = protectedText.replace(new RegExp(`\\b${escapedValue}\\b`, 'g'), token);
      tokenMap.push({ token, term: tokenValue });
      index += 1;
    }
  });

  return { text: protectedText, tokenMap };
}

function protectEmails(input) {
  let protectedText = input;
  const tokenMap = [];
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  let match;
  let index = 0;

  while ((match = emailRegex.exec(input)) !== null) {
    const email = match[0];
    const token = `ZXPROTECTEMAIL${index}ZX`;
    const escapedEmail = escapeRegExp(email);
    protectedText = protectedText.replace(new RegExp(escapedEmail, 'g'), token);
    tokenMap.push({ token, term: email });
    index += 1;
  }

  return { text: protectedText, tokenMap };
}

function protectDomainsAndUrls(input) {
  let protectedText = input;
  const tokenMap = [];
  let index = 0;

  const patterns = [
    /https?:\/\/[^\s"'<>]+/g,
    /\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?/g
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(input)) !== null) {
      const value = match[0];
      if (!value) {
        continue;
      }

      const token = `ZXPROTECTDOMAIN${index}ZX`;
      const escapedValue = escapeRegExp(value);
      protectedText = protectedText.replace(new RegExp(escapedValue, 'g'), token);
      tokenMap.push({ token, term: value });
      index += 1;
    }
  });

  return { text: protectedText, tokenMap };
}

function protectText(text) {
  const emailProtected = protectEmails(text);
  const domainProtected = protectDomainsAndUrls(emailProtected.text);
  // const codeProtected = protectCodeLikeTokens(domainProtected.text);
  const termProtected = protectTerms(domainProtected.text);

  return {
    text: termProtected.text,
    tokenMap: [...emailProtected.tokenMap, ...domainProtected.tokenMap, ...termProtected.tokenMap]
  };
}

function extractEmails(text) {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  return text.match(emailRegex) || [];
}

function preserveEmailsFromSource(sourceText, translatedText) {
  const sourceEmails = extractEmails(sourceText);
  if (sourceEmails.length === 0) {
    return translatedText;
  }

  let normalizedText = translatedText;
  sourceEmails.forEach((sourceEmail) => {
    const domain = sourceEmail.split('@')[1];
    if (!domain) {
      return;
    }

    const sameDomainEmailRegex = new RegExp(`\\b[A-Za-z0-9._%+-]+@${escapeRegExp(domain)}\\b`, 'g');
    normalizedText = normalizedText.replace(sameDomainEmailRegex, sourceEmail);
  });

  return normalizedText;
}

function restoreTerms(input, tokenMap) {
  let restored = input;
  tokenMap.forEach(({ token, term }) => {
    restored = restored.replace(new RegExp(escapeRegExp(token), 'g'), term);
  });
  return restored;
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    let completed = false;
    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
          Accept: 'application/json,text/plain,*/*',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      },
      (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          completed = true;
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Translation request failed with status ${res.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Invalid translation response: ${error.message}`));
          }
        });
      }
    );

    request.on('error', (error) => reject(error));
    request.setTimeout(15000, () => {
      if (!completed) {
        request.destroy(new Error('Translation request timeout after 15s'));
      }
    });
    request.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateText(text, targetLang, cache) {
  if (typeof text !== 'string' || text.trim() === '') {
    return text;
  }

  const cacheKey = `${targetLang}::${text}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const { text: protectedText, tokenMap } = protectText(text);

  const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
    targetLang
  )}&dt=t&q=${encodeURIComponent(protectedText)}`;

  let translated = '';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await httpGetJson(endpoint);
      translated = Array.isArray(response?.[0])
        ? response[0].map((part) => (Array.isArray(part) ? part[0] : '')).join('')
        : text;
      translated = restoreTerms(translated, tokenMap);
      translated = preserveEmailsFromSource(text, translated);
      break;
    } catch (error) {
      if (attempt === 3) {
        if (text.length > 120) {
          const parts = text.split(/([.!?。！？]\s+)/).filter((part) => part !== '');
          if (parts.length > 1) {
            const translatedParts = [];
            for (const part of parts) {
              const trimmed = part.trim();
              if (!trimmed) {
                translatedParts.push(part);
                continue;
              }

              const protectedPart = protectText(part);
              const partEndpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
                targetLang
              )}&dt=t&q=${encodeURIComponent(protectedPart.text)}`;
              try {
                const partResponse = await httpGetJson(partEndpoint);
                const translatedPart = Array.isArray(partResponse?.[0])
                  ? partResponse[0]
                      .map((piece) => (Array.isArray(piece) ? piece[0] : ''))
                      .join('')
                  : part;
                const restoredPart = restoreTerms(translatedPart || part, protectedPart.tokenMap);
                translatedParts.push(preserveEmailsFromSource(part, restoredPart));
              } catch (partError) {
                translatedParts.push(part);
              }
            }

            translated = translatedParts.join('');
            break;
          }
        }

        TRANSLATION_MISSES += 1;
        cache.set(cacheKey, text);
        return text;
      }

      await delay(250 * attempt);
    }
  }

  cache.set(cacheKey, translated || text);
  return translated || text;
}

async function translateHtmlContent(encodedHtml, targetLang, cache) {
  if (typeof encodedHtml !== 'string' || encodedHtml.trim() === '') {
    return encodedHtml;
  }

  const decodedHtml = decodeHtmlEntities(encodedHtml);
  const chunks = decodedHtml.split(/(<[^>]+>)/g);
  const translatedChunks = [];

  for (const chunk of chunks) {
    if (chunk.startsWith('<') && chunk.endsWith('>')) {
      translatedChunks.push(chunk);
      continue;
    }

    if (chunk.trim() === '') {
      translatedChunks.push(chunk);
      continue;
    }

    const translatedText = await translateText(chunk, targetLang, cache);
    translatedChunks.push(translatedText);
  }

  // Keep raw HTML here; XML escaping is handled once in formatDataTag.
  return translatedChunks.join('');
}

async function translateFieldsRecursively(sourceNode, targetNode, targetLang, cache) {
  if (!sourceNode || typeof sourceNode !== 'object') {
    return;
  }

  if (Array.isArray(sourceNode)) {
    for (let i = 0; i < sourceNode.length; i += 1) {
      await translateFieldsRecursively(sourceNode[i], targetNode[i], targetLang, cache);
    }
    return;
  }

  const entries = Object.entries(sourceNode);
  for (const [key, sourceValue] of entries) {
    if (TRANSLATABLE_FIELDS.has(key) && typeof sourceValue === 'string' && sourceValue.trim() !== '') {
      if (key === 'html_content' || key === 'richText' || key === 'description' || key === 'bodyMarkup') {
        targetNode[key] = await translateHtmlContent(sourceValue, targetLang, cache);
      } else {
        targetNode[key] = await translateText(sourceValue, targetLang, cache);
      }
      continue;
    }

    if (sourceValue && typeof sourceValue === 'object' && targetNode[key]) {
      await translateFieldsRecursively(sourceValue, targetNode[key], targetLang, cache);
    }
  }
}

function formatDataTag(lang, obj) {
  const jsonText = JSON.stringify(obj, null, 2);
  const xmlSafeJsonText = encodeHtmlEntities(jsonText);
  return `<data xml:lang="${lang}">${xmlSafeJsonText}</data>`;
}

async function processTranslation(inputPath = DEFAULT_INPUT_PATH, outputPath = DEFAULT_OUTPUT_PATH, options = {}) {
  const cloneLangs = options.cloneLangs || DEFAULT_CLONE_LANGS;
  if (options.protectedTerms) {
    PROTECTED_TERMS = options.protectedTerms.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (inputPath.indexOf('cookie-policy') >= 0) {
    var nontranslate = ['guest', 'loglevel', 'CookieConsent', 'SESS', 'CSS'];
    PROTECTED_TERMS.push(...nontranslate);
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const xml = fs.readFileSync(inputPath, 'utf8');
  const xmlDeclarationMatch = xml.match(/<\?xml[^>]*\?>/);
  const libraryOpenTagMatch = xml.match(/<library\b[^>]*>/);

  if (!libraryOpenTagMatch) {
    throw new Error('Cannot find <library ...> root element in source XML.');
  }

  const xmlDeclaration = xmlDeclarationMatch ? `${xmlDeclarationMatch[0]}\n` : '';
  const libraryOpenTag = libraryOpenTagMatch[0];

  const contentBlocks = xml.match(/<content\b[\s\S]*?<\/content>/g) || [];
  const resultContentBlocks = [];
  const translationCache = new Map();

  let skippedByType = 0;
  let skippedWithoutXDefault = 0;

  for (const block of contentBlocks) {
    const openTagMatch = block.match(/^<content\b[^>]*>/);
    const typeMatch = block.match(/<type>([\s\S]*?)<\/type>/);
    const xDefaultDataMatch = block.match(/<data\b[^>]*xml:lang="x-default"[^>]*>[\s\S]*?<\/data>/);

    if (!openTagMatch || !typeMatch) {
      continue;
    }

    const typeValue = typeMatch[1].trim();
    if (SKIP_TYPES.has(normalizeType(typeValue))) {
      skippedByType += 1;
      continue;
    }

    if (!xDefaultDataMatch) {
      skippedWithoutXDefault += 1;
      continue;
    }

    const openTag = openTagMatch[0];
    const xDefaultDataTag = xDefaultDataMatch[0];
    const xDefaultJsonMatch = xDefaultDataTag.match(/<data\b[^>]*>([\s\S]*?)<\/data>/);

    if (!xDefaultJsonMatch) {
      skippedWithoutXDefault += 1;
      continue;
    }

    let xDefaultObj;
    try {
      xDefaultObj = JSON.parse(xDefaultJsonMatch[1]);
    } catch (error) {
      throw new Error(`Invalid JSON in x-default data for type '${typeValue}': ${error.message}`);
    }

    const dataTags = [xDefaultDataTag];
    for (const lang of cloneLangs) {
      const translateCode = LANG_TO_TRANSLATE_CODE[lang] || lang;
      const langObj = deepClone(xDefaultObj);
      await translateFieldsRecursively(xDefaultObj, langObj, translateCode, translationCache);
      dataTags.push(formatDataTag(lang, langObj));
    }

    const contentOut = [
      `  ${openTag}`,
      `    <type>${typeValue}</type>`,
      ...dataTags.map((tag) => indentBlock(tag, 4)),
      '  </content>'
    ].join('\n');

    resultContentBlocks.push(contentOut);
  }

  const outputXml = [
    `${xmlDeclaration}${libraryOpenTag}`.trimEnd(),
    ...resultContentBlocks,
    '</library>',
    ''
  ].join('\n');

  fs.writeFileSync(outputPath, outputXml, 'utf8');

  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Total <content> blocks: ${contentBlocks.length}`);
  console.log(`Exported blocks: ${resultContentBlocks.length}`);
  console.log(`Skipped by type: ${skippedByType}`);
  console.log(`Skipped without x-default data: ${skippedWithoutXDefault}`);
  console.log(`Cloned languages: ${cloneLangs.join(', ')}`);
  console.log(`Protected terms: ${PROTECTED_TERMS.join(', ') || '(none)'}`);
  console.log(`Unique translation cache entries: ${translationCache.size}`);
  console.log(`Translation fallbacks (kept original): ${TRANSLATION_MISSES}`);
}

if (require.main === module) {
  processTranslation().catch((error) => {
    console.error('[extract-content-xdefault] Failed:', error.message);
    process.exit(1);
  });
} else {
  module.exports = { processTranslation, DEFAULT_CLONE_LANGS };
}
