import { syncReceipts } from './syncReceipts.js';
import puppeteer from '@cloudflare/puppeteer';

export default {
	async scheduled(_event, env, _ctx): Promise<void> {
		const browser = await puppeteer.launch(env.BROWSER as any);

		await syncReceipts(browser, env.TOKEN, env.BUDGET, env.EMAIL, env.PASSWORD);
	},
} satisfies ExportedHandler<Env>;
