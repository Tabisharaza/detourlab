import http from 'node:http';
import * as fileSystem from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseServeArguments } from './serve-options.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};

// The URL allowlist is not enough: stat/readFile follow links. Reject links at
// the preview root and every requested descendant, including links whose target
// is another allowed asset. This is a trusted-checkout preview, not a sandbox
// against a co-writer replacing path components between these checks and reads.
async function requireAssetFile(fs, sourceRoot, relative) {
  let current = sourceRoot;
  const parts = relative.split('/').filter(Boolean);
  for (let index = 0; index <= parts.length; index += 1) {
    if (index) current = path.join(current, parts[index - 1]);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || !(index === parts.length ? info.isFile() : info.isDirectory())) {
      throw new Error('Not a regular preview asset');
    }
  }
}

// Keep the request boundary importable for deterministic I/O-failure tests.
// The optional filesystem adapter does not change the CLI's normal disk reads.
export function createRequestHandler(directory = root, fs = fileSystem) {
  const sourceRoot = path.resolve(directory);
  return async (req,res) => {
    try {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return; }
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const full = path.resolve(sourceRoot,relative);
      // URL paths use '/', never host-specific backslash separators.
      if (relative.includes('\\') || !full.startsWith(sourceRoot + path.sep) || relative.split('/').some(s=>s.startsWith('.')) || !['index.html','src','public','examples'].includes(relative.split('/')[0])) { res.writeHead(404);res.end('Not found');return; }
      await requireAssetFile(fs, sourceRoot, relative);
      // A rebuild can remove an asset between stat and readFile. Do not commit a
      // successful response until all GET bytes are available: a second writeHead
      // from the error path would reject this async handler and stop the server.
      const body = req.method === 'HEAD' ? undefined : await fs.readFile(full);
      res.writeHead(200,{'Content-Type':types[path.extname(full)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",'Referrer-Policy':'no-referrer'});
      res.end(body);
    } catch {res.writeHead(404);res.end('Not found');}
  };
}

if (import.meta.main) {
  try {
    const options = parseServeArguments(process.argv.slice(2), process.env.PORT);
    const directory = path.resolve(root, options.dist ? 'dist' : '.');
    const server = http.createServer(createRequestHandler(directory));
    // Always strict: never try another port or widen the loopback host.
    server.once('error', error => {
      console.error(`DetourLab: cannot listen on ${options.host}:${options.port} (${error.code || 'listen error'}).`);
      process.exitCode = 1;
    });
    server.listen(options.port, options.host, () => console.log(`DetourLab → http://${options.host}:${options.port}`));
  } catch (error) {
    console.error(`DetourLab: ${error.message}`);
    process.exitCode = 2;
  }
}
