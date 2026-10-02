import fs from 'node:fs/promises'; import { pool } from '../src/lib/db.js';
const name=process.argv[2]||'uat_baseline'; const u=new URL(`../db/seed/${name}.sql`,import.meta.url); const sql=await fs.readFile(u,'utf8'); await pool.query(sql); await pool.end(); console.log('Seed complete:',name);
