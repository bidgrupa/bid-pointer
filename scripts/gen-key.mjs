// One-off: generates the `key` for manifest.json so the extension id (and therefore the
// ClickUp OAuth redirect URL) is the same on every machine that loads dist/ unpacked.
// Prints the manifest key, the resulting extension id and the redirect URL.
import { createHash, generateKeyPairSync } from 'node:crypto';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const key = der.toString('base64');
const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
  .map((h) => String.fromCharCode(97 + parseInt(h, 16)))
  .join('');
console.log(JSON.stringify({ key, id, redirect: `https://${id}.chromiumapp.org/` }, null, 2));
