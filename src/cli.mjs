import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { install, sync } from './install.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion() {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  return pkg.version;
}

function showHelp() {
  console.log(`
  ██████╗ █████╗ ██████╗ ███████╗████████╗
  ██╔════╝██╔══██╗██╔══██╗██╔════╝╚══██╔══╝
  ██║     ███████║██║  ██║█████╗     ██║
  ██║     ██╔══██║██║  ██║██╔══╝     ██║
  ╚██████╗██║  ██║██████╔╝███████╗   ██║
   ╚═════╝╚═╝  ╚═╝╚═════╝ ╚══════╝   ╚═╝

  Cross-IDE agent framework for Unity/C# game-development

  Usage:
    npx cadet-agent@latest init     Install Cadet-Agent into the current directory
    npx cadet-agent@latest init --target <dir>   Install into a specific directory
    npx cadet-agent@latest sync     Update framework, preserving local policies/plans
    npx cadet-agent@latest sync --target <dir>   Sync a specific directory

  Options:
    --target, -t  Target directory (default: current working directory)
    --source       Release API URL override (for forked deployments)
    --help, -h    Show this help
    --version, -v Show version number
`);
}

export async function run(argv) {
  const command = argv[2];

  // Parse --target <dir> or -t <dir>
  let targetDir = process.cwd();
  let sourceUrl = null;
  const targetIdx = argv.indexOf('--target');
  const tIdx = argv.indexOf('-t');
  const sourceIdx = argv.indexOf('--source');
  if (targetIdx !== -1 && argv[targetIdx + 1]) {
    targetDir = argv[targetIdx + 1];
  } else if (tIdx !== -1 && argv[tIdx + 1]) {
    targetDir = argv[tIdx + 1];
  }
  if (sourceIdx !== -1 && argv[sourceIdx + 1]) {
    sourceUrl = argv[sourceIdx + 1];
  }

  switch (command) {
    case 'init':
      await install(targetDir, { sourceUrl });
      break;
    case 'sync':
      await sync(targetDir, { sourceUrl });
      break;
    case '--version':
    case '-v':
      console.log(`cadet-agent v${getVersion()}`);
      break;
    case '--help':
    case '-h':
    case undefined:
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run cadet-agent --help for usage.');
      process.exit(1);
  }
}
