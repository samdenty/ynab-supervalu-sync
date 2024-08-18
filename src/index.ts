import dotenv from 'dotenv';
import toml from 'toml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { syncReceipts } from './syncReceipts.js';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
	path: path.join(__dirname, '../.dev.vars'),
});

const env: Env = {
	...process.env,
	...toml.parse(fs.readFileSync(path.join(__dirname, '../wrangler.toml'), 'utf8')).vars,
};

try {
	const browser = await puppeteer.launch({
		headless: false,
	});
	await syncReceipts(browser as any, process.env.TOKEN!, env.BUDGET, env.EMAIL, env.PASSWORD);
	process.exit();
} catch (e) {
	console.error(e);
	process.exit(1);
}
