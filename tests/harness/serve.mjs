import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

http
  .createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(root, p);
    fs.readFile(f, (e, d) => {
      if (e) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(f)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(d);
    });
  })
  .listen(8143, () => console.log('serving on 8143'));
