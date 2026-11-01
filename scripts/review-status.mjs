import {readFile} from 'node:fs/promises';
import {summarizeReview} from '../src/core/review.ts';
const path=process.argv[2];
if(!path)throw new Error('Pass the private review.json file');
const rows=JSON.parse(await readFile(path,'utf8'));
console.log(JSON.stringify({reviewedBy:'human entries only',rules:summarizeReview(rows)},null,2));
