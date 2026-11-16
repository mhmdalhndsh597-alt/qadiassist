import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema.js';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
export const pool = mysql.createPool(url);
export const db = drizzle(pool, { schema, mode: 'default' });
