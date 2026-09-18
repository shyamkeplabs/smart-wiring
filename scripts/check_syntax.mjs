import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('src/main.tsx');
const source = fs.readFileSync(file, 'utf8');
if (!source.includes('createRoot(') || !source.includes('<ReactFlow')) {
  throw new Error('Frontend source sanity check failed.');
}
console.log('KLS frontend source sanity check: PASS');
