// Tiny argument parser shared by the maintenance scripts.
//
//   const { args, opts } = parseArgs(process.argv.slice(2), {
//     usage: 'node tool.js <in> [--locale <code|path>]',
//     min: 1,                       // required positional arguments
//     options: { locale: 'zh-TW' }, // --name <value> options with their defaults (null = no default)
//     flags: ['dry'],               // optional --name switches that take no value (opts.name is true when given)
//   });
//
// Missing positionals or unknown options print the usage line and exit 1.
// --help prints the usage line and exits 0.
'use strict';

function parseArgs(argv, { usage, min = 0, max = Infinity, options = {}, flags = [] }) {
  const fail = (msg) => {
    if (msg) console.error(msg);
    console.error(`Usage: ${usage}`);
    process.exit(1);
  };
  const args = [];
  const opts = { ...options };
  for (const f of flags) opts[f] = false;
  for (const f of flags) opts[f] = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(`Usage: ${usage}`);
      process.exit(0);
    }
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (flags.includes(name)) { opts[name] = true; continue; }
      if (!(name in options)) fail(`unknown option ${a}`);
      if (i + 1 >= argv.length) fail(`option ${a} needs a value`);
      opts[name] = argv[++i];
    } else {
      args.push(a);
    }
  }
  if (args.length < min) fail(`expected at least ${min} argument(s), got ${args.length}`);
  if (args.length > max) fail(`expected at most ${max} argument(s), got ${args.length}`);
  return { args, opts };
}

module.exports = { parseArgs };
