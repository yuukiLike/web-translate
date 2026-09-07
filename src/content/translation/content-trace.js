import { createContentTracePackets } from "./content-trace-packets.js";

const MAX_PATH_CHARACTERS = 4_096;
const MAX_ALIASES_PER_MESSAGE = 1_000;

/** 只观测本轮已选中的翻译内容。节点身份随运行释放，不向网页写入调试属性。 */
export class ContentTrace {
	#nodeIds = new WeakMap();
	#nodeSequence = 0;
	#scanSequence = 0;
	#pending = Promise.resolve();

	constructor({ enabled, runId, runtime, runCache }) {
		this.enabled = enabled === true;
		this.runId = runId;
		this.runtime = runtime;
		this.runCache = runCache;
	}

	recordPlan(segments) {
		if (!this.enabled || segments.length === 0) return this.#pending;
		try {
			const nodes = new Map();
			let truncated = false;
			const plannedSegments = segments.map((segment) => ({
				id: segment.id,
				text: segment.text,
				sourceLanguage: segment.sourceLanguage,
				targetLanguage: segment.targetLanguage,
				cache: this.runCache.has(segment) ? "memory" : "pending",
				targets: segment.targets.map(({ record, partIndex }) => {
					const nodeId = this.#getNodeId(record.element);
					const key = `${nodeId}:${record.revision}`;
					if (!nodes.has(key)) {
						const path = getStructuralPath(record.element);
						truncated ||= path.truncated;
						nodes.set(key, {
							id: nodeId,
							tag: record.element.localName,
							path: path.text,
							revision: record.revision,
							text: record.sourceText,
						});
					}
					return { nodeId, partIndex, partCount: record.parts.length };
				}),
			}));
			this.#scanSequence += 1;
			const packets = createContentTracePackets({
				scanId: `${this.runId}-scan-${this.#scanSequence}`,
				nodes: [...nodes.values()],
				segments: plannedSegments,
				truncated,
			});
			const document = segments[0]?.targets[0]?.record.element.ownerDocument;
			if (packets[0] && document) {
				packets[0].document = {
					title: document.title.slice(0, 512),
					url: document.location.href.slice(0, 4_096),
				};
			}
			for (const trace of packets) this.#enqueue({ type: "CONTENT_TRACE", trace });
		} catch {
			// 页面节点在采集期间失效或序列化失败，不应阻断翻译。
		}
		return this.#pending;
	}

	recordAliases(aliases) {
		if (!this.enabled || aliases.length === 0) return this.#pending;
		for (let offset = 0; offset < aliases.length; offset += MAX_ALIASES_PER_MESSAGE) {
			this.#enqueue({
				type: "CONTENT_TRACE_ALIAS",
				aliases: aliases.slice(offset, offset + MAX_ALIASES_PER_MESSAGE),
			});
		}
		return this.#pending;
	}

	#getNodeId(element) {
		let id = this.#nodeIds.get(element);
		if (!id) {
			this.#nodeSequence += 1;
			id = `${this.runId}-node-${this.#nodeSequence}`;
			this.#nodeIds.set(element, id);
		}
		return id;
	}

	#enqueue(message) {
		this.#pending = this.#pending
			.then(() => this.runtime.send({ ...message, runId: this.runId }))
			.catch(() => {});
	}
}

function getStructuralPath(element) {
	const parts = [];
	let characters = 0;
	for (let current = element; current; current = current.parentElement) {
		const tag = current.localName;
		let index = 1;
		for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
			if (sibling.localName === tag) index += 1;
		}
		const part = `${tag}:nth-of-type(${index})`;
		characters += part.length + 3;
		if (characters > MAX_PATH_CHARACTERS) {
			return { text: `… > ${parts.reverse().join(" > ")}`, truncated: true };
		}
		parts.push(part);
	}
	return { text: parts.reverse().join(" > "), truncated: false };
}
