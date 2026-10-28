// Pure argument parsing: importing this module never creates a server or reads
// files. Explicit --port overrides PORT; otherwise the existing default is 4173.
export function parseServeArguments(args = [], environmentPort) {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) {
    throw new Error('preview arguments must be strings.');
  }
  const seen = new Set();
  const options = { host: '127.0.0.1', port: 4173, dist: false, strictPort: true };
  let explicitPort;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!['--host', '--port', '--dist', '--strictPort'].includes(flag)) {
      throw new Error(`unknown preview option: ${flag}.`);
    }
    if (seen.has(flag)) throw new Error(`${flag} may only be supplied once.`);
    seen.add(flag);
    if (flag === '--dist') options.dist = true;
    else if (flag === '--host' || flag === '--port') {
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
      if (flag === '--host') {
        if (value !== '127.0.0.1') throw new Error('--host must be 127.0.0.1; this preview is loopback-only.');
      } else explicitPort = value;
    }
  }
  const port = explicitPort ?? (environmentPort || '4173');
  if (typeof port !== 'string' || !/^[0-9]{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('preview port must be a decimal integer from 1 to 65535.');
  }
  options.port = Number(port);
  return options;
}
