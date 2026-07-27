import { AsyncLocalStorage } from "node:async_hooks";

import {
	ProxyAgent,
	getGlobalDispatcher,
	setGlobalDispatcher,
} from "undici";

const proxyContext = new AsyncLocalStorage();
const MAX_PROXY_DISPATCHERS = 256;
let routingDispatcher;

function dispatcherFor(proxyUrl) {
	let dispatcher = routingDispatcher.proxies.get(proxyUrl);
	if (!dispatcher) {
		if (routingDispatcher.proxies.size >= MAX_PROXY_DISPATCHERS) {
			throw new Error("Provider proxy dispatcher capacity is full");
		}
		dispatcher = new ProxyAgent(proxyUrl);
		routingDispatcher.proxies.set(proxyUrl, dispatcher);
	}
	return dispatcher;
}

function install() {
	if (routingDispatcher) {
		return;
	}
	const direct = getGlobalDispatcher();
	routingDispatcher = {
		direct,
		proxies: new Map(),
		dispatch(options, handler) {
			const proxyUrl = proxyContext.getStore();
			return (
				proxyUrl ? dispatcherFor(proxyUrl) : direct
			).dispatch(options, handler);
		},
	};
	setGlobalDispatcher(routingDispatcher);
}

function scopedIterator(iterator, proxyUrl) {
	return {
		next(...args) {
			return proxyContext.run(proxyUrl, () => iterator.next(...args));
		},
		return(...args) {
			return typeof iterator.return === "function"
				? proxyContext.run(proxyUrl, () => iterator.return(...args))
				: Promise.resolve({ done: true, value: undefined });
		},
		throw(...args) {
			return typeof iterator.throw === "function"
				? proxyContext.run(proxyUrl, () => iterator.throw(...args))
				: Promise.reject(args[0]);
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	};
}

function scopedAsyncIterable(value, proxyUrl) {
	if (!value || typeof value[Symbol.asyncIterator] !== "function") {
		return value;
	}
	return new Proxy(value, {
		get(target, property) {
			if (property === Symbol.asyncIterator) {
				return () => scopedIterator(
					proxyContext.run(proxyUrl, () => target[Symbol.asyncIterator]()),
					proxyUrl,
				);
			}
			const selected = Reflect.get(target, property, target);
			return typeof selected === "function"
				? (...args) => proxyContext.run(
					proxyUrl,
					() => selected.apply(target, args),
				)
				: selected;
		},
	});
}

export function withProviderProxy(proxyUrl, operation) {
	if (!proxyUrl) {
		return operation();
	}
	install();
	return scopedAsyncIterable(
		proxyContext.run(proxyUrl, operation),
		proxyUrl,
	);
}
