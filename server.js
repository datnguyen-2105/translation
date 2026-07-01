const http = require('http');
const fs = require('fs');
const path = require('path');
const { processTranslation, DEFAULT_CLONE_LANGS } = require('./extract-content-xdefault.js');
const { processProductTranslation } = require('./extract-product-xdefault.js');
const { mergeProductXml, mergeLibraryXml } = require('./merge-xml.js');


const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.xml': 'application/xml',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    // Remove query string if any
    filePath = filePath.split('?')[0];
    const absPath = path.join(PUBLIC_DIR, filePath);

    // Prevent directory traversal
    if (!absPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(absPath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('Not Found');
        } else {
          res.writeHead(500);
          res.end('Server Error');
        }
        return;
      }
      const ext = path.extname(absPath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
      res.end(data);
    });

  } else if (req.method === 'POST' && req.url === '/api/translate') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk.toString(); });
    req.on('end', async () => {
      try {
        const body = JSON.parse(bodyStr);
        const xmlFormat = body.xmlFormat || 'page-designer';

        const cloneLangs = (body.targetLanguages && body.targetLanguages.length > 0) 
          ? body.targetLanguages 
          : DEFAULT_CLONE_LANGS;

        const options = {
          cloneLangs,
          protectedTerms: body.protectedTerms || ''
        };

        // Normalize input: support both single xmlContent and multi xmlContents
        let files = [];
        if (body.xmlContents && Array.isArray(body.xmlContents) && body.xmlContents.length > 0) {
          files = body.xmlContents; // [{ name, content }]
        } else if (body.xmlContent) {
          files = [{ name: 'file.xml', content: body.xmlContent }];
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No XML content provided.' }));
        }

        const translateFn = xmlFormat === 'product-section' ? processProductTranslation : processTranslation;

        // Translate all files in parallel (semaphore controls API concurrency)
        const translatedXmls = await Promise.all(files.map(async (file, i) => {
          const tempId = `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
          const inputPath = path.join(__dirname, `temp_input_${tempId}.xml`);
          const outputPath = path.join(__dirname, `temp_output_${tempId}.xml`);

          try {
            fs.writeFileSync(inputPath, file.content, 'utf8');
            await translateFn(inputPath, outputPath, options);
            return fs.readFileSync(outputPath, 'utf8');
          } finally {
            // Cleanup temp files
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          }
        }));

        // Merge if multiple files, otherwise return single result
        let finalXml;
        if (translatedXmls.length > 1) {
          finalXml = xmlFormat === 'product-section'
            ? mergeProductXml(translatedXmls)
            : mergeLibraryXml(translatedXmls);
        } else {
          finalXml = translatedXmls[0];
        }

        // Send back
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          xmlContent: finalXml,
          fileCount: files.length
        }));

      } catch (error) {
        console.error('Translation error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message || 'An error occurred during translation.' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
