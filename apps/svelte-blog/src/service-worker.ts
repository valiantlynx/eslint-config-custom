/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const FILES = `cache${version}`;

// `build` is an array of all the files generated by the bundler,
// `files` is an array of everything in the `static` directory
const to_cache = build.concat(files);
//to_cache.push('/offline.html'); // Add your new resource URL here
const staticAssets = new Set(to_cache);

worker.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(FILES)
			.then((cache) => cache.addAll(to_cache))
			.then(() => {
				worker.skipWaiting();
			})
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			// delete old caches
			for (const key of keys) {
				if (key !== FILES) await caches.delete(key);
			}

			worker.clients.claim();
		})
	);
});

/**
 * Fetch the asset from the network and store it in the cache.
 * Fall back to the cache if the user is offline.
 */
async function fetchAndCache(request: Request) {
	const cache = await caches.open(`offline${version}`);

	try {
		const response = await fetch(request);
		cache.put(request, response.clone());
		return response;
	} catch (err) {
		const response = await cache.match(request);
		if (response) return response;

		throw err;
	}
}

worker.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET' || event.request.headers.has('range')) return;

	const url = new URL(event.request.url);
	const uncachedRoutes = ['/søk', '/stasjon'];

	// Check if the requested URL matches any of the uncached routes
	const isUncachedRoute = uncachedRoutes.some((route) => url.pathname.startsWith(route));

	// don't try to handle e.g. data: URIs
	const isHttp = url.protocol.startsWith('http');
	const isDevServerRequest =
		url.hostname === self.location.hostname && url.port !== self.location.port;
	const isStaticAsset = url.host === self.location.host && staticAssets.has(url.pathname);
	const skipBecauseUncached = event.request.cache === 'only-if-cached' && !isStaticAsset;

	if (isHttp && !isDevServerRequest && !skipBecauseUncached && !isUncachedRoute) {
		event.respondWith(
			(async () => {
				if (!navigator.onLine) {
					// Check if the user is offline
					// Serve cached content or an offline page here
					// always serve static files and bundler-generated assets from cache.
					// if your application has other URLs with data that will never change,
					// set this variable to true for them and they will only be fetched once.
					const cachedAsset = isStaticAsset && (await caches.match(event.request));
					if (cachedAsset) {
						return cachedAsset;
					} else {
						return caches.match('/offline.html'); // Replace with the actual path to your offline page
					}
				} else {
					// Online, try to fetch from the network and cache the response
					const response = await fetchAndCache(event.request);
					return response;
				}
			})()
		);
	}
});
