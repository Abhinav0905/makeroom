import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const secrets=readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(l=>/^(PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|GEMINI_API_KEY)=/.test(l)).map(l=>l.slice(l.indexOf('=')+1)).filter(v=>v.length>20);
const skip=new Set(['node_modules','.git','.wrangler','.sites-runtime','.vinext','outputs','work']);
const found=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
 if(skip.has(entry.name)||entry.name.startsWith('.dev.vars')||entry.name.startsWith('.env'))continue;
 const path=join(dir,entry.name);
 if(entry.isDirectory())walk(path);else if(entry.isFile()&&secrets.some(s=>readFileSync(path).includes(s)))found.push(path);
}}
walk('.');
if(found.length){console.error('Credential values found in:',found.join(', '));process.exitCode=1;}else console.log('No configured credential values found in source or built assets.');
