import { Browser } from '@cloudflare/puppeteer';
import * as ynab from 'ynab';
import day from 'dayjs';
import dayjs from 'dayjs';

interface ReceiptItem {
	name: string;
	price: number;
	quantity: number;
}

interface Receipt {
	id: string;
	date: string;
	storeName: string;
	total: number;
	paid: number;
	items: ReceiptItem[];
}

export async function syncReceipts(
	browser: import('@cloudflare/puppeteer').Browser,
	token: string,
	budget: string,
	email: string,
	password: string
) {
	const ynabAPI = new ynab.API(token);

	const page = await browser.newPage();

	await page.goto('https://supervalu.ie/login', { waitUntil: 'networkidle0' });

	await page.type('input[type=email]', email);

	await page.type('input[type=password]', password);

	await page.click('button[type=primary]');

	const receipts = await (
		await page.waitForFunction(async () => {
			const { apiKey } = (window as any).oidcClientSettings || {};
			const token = localStorage.janrainCaptureToken;

			if (!apiKey || !token) {
				return null!;
			}

			async function apiCall<T>(url: string): Promise<T> {
				const res = await fetch(`https://supervalu-loyalty-web.api.prod.musgrave.io/v2${url}`, {
					headers: {
						Authorization: `Bearer ${token}`,
						apikey: apiKey,
					},
				});

				return res.json();
			}

			const { baskets } = await apiCall<{ baskets: any[] }>('/baskets');

			return Promise.all(
				baskets.map((basket) =>
					apiCall<{ view: string }>(`/baskets/${basket.type}/${basket.id}`).then(({ view }): Receipt => {
						const html = document.createElement('html');
						html.innerHTML = view;

						const rows = [...html.querySelectorAll('.row:not(hr ~ .row)')];

						const individualItems = rows
							.map((row) => {
								const name = row.querySelector('.left')?.textContent;
								const price = row.querySelector('.right')?.textContent;

								if (!name || !price) {
									return null!;
								}

								return {
									name,
									price: Number(price.slice(1)) * 1000,
								};
							})
							.filter(Boolean);

						const items: ReceiptItem[] = [];

						for (const { name, price } of individualItems) {
							let item = items.find((item) => item.name === name);
							if (!item) {
								item = {
									name,
									price,
									quantity: 0,
								};

								items.push(item);
							}

							item.quantity++;
						}

						return {
							...basket,
							total: basket.total * 1000,
							paid: basket.paid * 1000,
							items,
						};
					})
				)
			);
		})
	).jsonValue();

	const response = await ynabAPI.transactions.getTransactions(budget);
	const { transactions } = response.data;

	const transactionsToUpdate: ynab.TransactionDetail[] = [];

	for (const receipt of receipts) {
		const time = dayjs(receipt.date).startOf('day');
		const amount = -receipt.paid;

		const possibleTransactions = transactions.filter((transaction) => {
			const transactionTime = day(transaction.date).startOf('day');

			if (transaction.payee_name !== 'Supervalu' || transaction.amount > 0) {
				return false;
			}

			if (transactionTime < time || transactionTime > time.add(1, 'week')) {
				return false;
			}

			if (transaction.amount !== amount) {
				return false;
			}

			return true;
		});

		const transaction = possibleTransactions[0];
		if (!transaction) {
			continue;
		}

		if (transaction.subtransactions.length || (receipt.items.length === 1 && transaction.memo)) {
			continue;
		}

		let totalAmount = 0;

		receipt.items.forEach((item) => {
			item.price = -item.price * item.quantity;
			totalAmount += item.price;
		});

		const ratio = amount / totalAmount;
		totalAmount = 0;

		receipt.items.forEach((item, i) => {
			item.price = i === receipt.items.length - 1 ? Math.abs(totalAmount) - Math.abs(amount) : Math.round(item.price * ratio);

			totalAmount += item.price;
		});

		receipt.items.sort((a, b) => a.price - b.price);

		if (receipt.items.length === 1) {
			transaction.memo = getDescription(receipt.items[0]);
		} else {
			transaction.subtransactions = [];
			transaction.subtransactions = receipt.items.map((item): any => ({
				amount: item.price,
				payee_id: transaction.payee_id,
				payee_name: transaction.payee_name,
				category_id: transaction.category_id,
				memo: getDescription(item),
			}));
		}

		transactionsToUpdate.push(transaction);
	}

	if (transactionsToUpdate.length) {
		await ynabAPI.transactions.updateTransactions(budget, {
			transactions: transactionsToUpdate,
		});
	}
}

function getDescription(item: ReceiptItem) {
	if (item.quantity === 1) {
		return item.name;
	}

	return `${item.quantity}x ${item.name}`;
}
