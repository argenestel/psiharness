/** JSON requests shared by the web views. */
async function request(method, path, body) {
	const response = await fetch(path, {
		method, headers: { "X-Psi": "1", "Content-Type": "application/json", Accept: "application/json" },
		...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
	});
	let data;
	try { data = await response.json(); } catch { data = {}; }
	if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
	return data;
}
export const api = {
	get: (path) => request("GET", path),
	post: (path, body) => request("POST", path, body),
	patch: (path, body) => request("PATCH", path, body),
	put: (path, body) => request("PUT", path, body),
	del: (path) => request("DELETE", path),
};

/** Reconnect explicitly so the query cursor always reflects the latest delivered record. */
export function openEvents(chatId, { since = 0, onRecord, onOpen, onError } = {}) {
	let cursor = Number(since) || 0;
	let source, timer, closed = false;
	function connect() {
		if (closed) return;
		source = new EventSource(`/api/chat/${encodeURIComponent(chatId)}/events?since=${cursor}`);
		source.onopen = (event) => onOpen?.(event);
		source.onmessage = (event) => {
			let record;
			try { record = JSON.parse(event.data); } catch (error) { onError?.(error); return; }
			const seq = Number(record.seq ?? event.lastEventId);
			if (Number.isFinite(seq) && seq > 0) {
				if (seq <= cursor) return;
				cursor = seq;
			}
			onRecord?.(record);
		};
		source.onerror = (event) => {
			source.close();
			if (!closed) timer = setTimeout(connect, 1000);
			onError?.(event);
		};
	}
	connect();
	return () => { closed = true; clearTimeout(timer); source?.close(); };
}
