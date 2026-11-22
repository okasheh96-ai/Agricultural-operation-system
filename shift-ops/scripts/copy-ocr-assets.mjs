// Copies the OCR engine and Arabic/English language data into dist/ocr so photos are read on the device
// without any third-party download.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const nm = 'node_modules';
const out = 'dist/ocr';
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });
cpSync(join(nm, 'tesseract.js/dist/worker.min.js'), join(out, 'worker.min.js'));
for (const f of readdirSync(join(nm, 'tesseract.js-core'))) {
  if (/^tesseract-core.*lstm\.(wasm\.js|js|wasm)$/.test(f)) cpSync(join(nm, 'tesseract.js-core', f), join(out, 'core', f));
}
cpSync(join(nm, '@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz'), join(out, 'lang/ara.traineddata.gz'));
cpSync(join(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), join(out, 'lang/eng.traineddata.gz'));
console.log('OCR assets copied to', out);
