const http = require('http');
const fs = require('fs');
const path = require('path');
const { processTranslation, DEFAULT_CLONE_LANGS } = require('./extract-content-xdefault.js');

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
        if (!body.xmlContent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No XML content provided.' }));
        }

        const cloneLangs = (body.targetLanguages && body.targetLanguages.length > 0) 
          ? body.targetLanguages 
          : DEFAULT_CLONE_LANGS;

        const options = {
          cloneLangs,
          protectedTerms: body.protectedTerms || ''
        };

        // Create temporary files for the script to use
        const tempId = Date.now();
        const inputPath = path.join(__dirname, `temp_input_${tempId}.xml`);
        const outputPath = path.join(__dirname, `temp_output_${tempId}.xml`);

        fs.writeFileSync(inputPath, body.xmlContent, 'utf8');

        // Run translation
        await processTranslation(inputPath, outputPath, options);

        // Read the result
        const translatedContent = fs.readFileSync(outputPath, 'utf8');

        // Cleanup
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

        // Send back
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ xmlContent: translatedContent }));

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
