import type { Envelope, Middleware, Transport } from "./types";

export class Pipeline {
	private middlewares: Middleware[] = [];
	private transports: Transport[] = [];

	use(mw: Middleware) {
		this.middlewares.push(mw);
	}

	addTransport(t: Transport) {
		this.transports.push(t);
	}

	async dispatch(entry: Envelope): Promise<void> {
		const terminal = async () => {
			// do not fail the whole chain because one transport failed
			await Promise.allSettled(
				this.transports.map((t) => Promise.resolve(t(entry))),
			);
		};

		const run = compose(this.middlewares, terminal);
		await run(entry);
	}
}

export function compose(
	middlewares: Middleware[],
	terminal: () => Promise<void>,
) {
	return async (entry: Envelope) => {
		let idx = -1;

		const runner = async (i: number): Promise<void> => {
			if (i <= idx) {
				throw new Error("next() called multiple times");
			}
			idx = i;

			const mw = middlewares[i];
			if (!mw) {
				await terminal();
				return;
			}

			await mw(entry, () => runner(i + 1));
		};

		await runner(0);
	};
}
