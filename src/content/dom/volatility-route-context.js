/** SPA 路由切换时开启新的易变判断世代；hash 变化不代表正文换页。 */
export class VolatilityRouteContext {
	#routeKey;

	constructor({ tracker, lineage, getRouteKey = getCurrentRouteKey }) {
		this.tracker = tracker;
		this.lineage = lineage;
		this.getRouteKey = getRouteKey;
	}

	sync() {
		const routeKey = String(this.getRouteKey() ?? "");
		if (this.#routeKey === undefined) {
			this.#routeKey = routeKey;
			return;
		}
		if (this.#routeKey === routeKey) {
			return;
		}
		this.#routeKey = routeKey;
		this.lineage.reset();
		this.tracker.reset();
	}
}

function getCurrentRouteKey() {
	const location = globalThis.location;
	return location
		? `${location.origin ?? ""}${location.pathname ?? ""}${location.search ?? ""}`
		: "";
}
