// Bootstrap Icons' classic Twitter bird, recolored green; see icons/LICENSE-bootstrap.txt.
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const root = new URL('../extension/icons/', import.meta.url);
const svg = readFileSync(new URL('twitter.svg', root), 'utf8');
for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`${size}.png`, root), new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
}
