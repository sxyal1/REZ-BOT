import { readFileSync } from 'fs';

let token = readFileSync(new URL('./token.txt', import.meta.url), 'utf8');
token = token.replace(/^\uFEFF/, '').trim().split(/\r?\n/)[0].trim();
if (!token) {
  console.error('token.txt пустой');
  process.exit(1);
}
process.env.DISCORD_TOKEN = token;
await import('./bot.js');
