// Builds one deployable folder per Lambda service: dist/<service>/ (zipped by infra/modules/lambda-service).
//
//   dist/items/
//     index.js            entry point for handler "index.handler": re-exports functions/items/index.js
//     package.json        { "type": "module" } so Lambda loads the files as ES modules
//     functions/items/    this service's code, transpiled 1:1 from src/ by tsc (not bundled, not minified)
//     shared/             code shared by both services
//     node_modules/       production dependencies only (pg, AWS SDK), versions from package-lock.json
//
//   npm run build
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const SERVICES = ['items', 'attachments'];

const run = (cmd: string, cwd = '.') => execSync(cmd, { cwd, stdio: 'inherit' });

// 1. Clean
rmSync('build', { recursive: true, force: true });
rmSync('dist', { recursive: true, force: true });

// 2. Type-check and transpile src/ -> build/ (same folder layout, comments kept)
run('npx tsc -p tsconfig.build.json');

// 3. Production dependencies, installed once and copied into every service
mkdirSync('build/.deps', { recursive: true });
cpSync('package.json', 'build/.deps/package.json');
cpSync('package-lock.json', 'build/.deps/package-lock.json');
run('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', 'build/.deps');

// 4. Assemble dist/<service>/
for (const svc of SERVICES) {
  const out = `dist/${svc}`;
  cpSync(`build/functions/${svc}`, `${out}/functions/${svc}`, { recursive: true });
  cpSync('build/shared', `${out}/shared`, { recursive: true });
  cpSync('build/.deps/node_modules', `${out}/node_modules`, { recursive: true });
  writeFileSync(`${out}/package.json`, `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  writeFileSync(
    `${out}/index.js`,
    `// Lambda entry point (handler: index.handler). Source: src/functions/${svc}/index.ts\n` +
      `export { handler } from './functions/${svc}/index.js';\n`,
  );
  console.log(`built ${out}`);
}
