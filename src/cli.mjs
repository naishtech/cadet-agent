import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { install } from './install.mjs';

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

  Options:
    --target, -t  Target directory (default: current working directory)
    --help, -h    Show this help
    --version, -v Show version number
`);
}

export async function run(argv) {
  const command = argv[2];

  // Parse --target <dir> or -t <dir>
  let targetDir = process.cwd();
  const targetIdx = argv.indexOf('--target');
  const tIdx = argv.indexOf('-t');
  if (targetIdx !== -1 && argv[targetIdx + 1]) {
    targetDir = argv[targetIdx + 1];
  } else if (tIdx !== -1 && argv[tIdx + 1]) {
    targetDir = argv[tIdx + 1];
  }

  switch (command) {
    case 'init':
      await install(targetDir);
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
