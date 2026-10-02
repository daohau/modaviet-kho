import fs from 'node:fs/promises'; import path from 'node:path'; import { pool } from '../src/lib/db.js';
const dir=new URL('../db/migrations/',import.meta.url); const files=(await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort();
for(const f of files){console.log('Applying',f);const sql=await fs.readFile(new URL(f,dir),'utf8');await pool.query(sql);} await pool.end(); console.log('Migrations complete');
