import { safeString } from "../core/value-utils.js";
import { formatDebugTime, formatEndpoint, normalizeDebugEvents } from "./debugFormat.js";

const text = (value, limit = 300) => safeString(value, "", limit);
const contentText = (value) => typeof value === "string" ? value : "";
const array = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

function createRun(event) {
	return {
		id: event.runId,
		tabId: event.tabId,
		time: formatDebugTime(event.timestamp),
		scans: new Map(),
		batches: new Map(),
		aliases: new Map(),
		requests: [], title: "", url: "",
	};
}

function acceptPlan(run, event) {
	const trace = event.contentTrace;
	if (!trace || trace.version !== 1 || !text(trace.scanId)) return;
	if (trace.document) {
		run.title = text(trace.document.title, 500) || run.title;
		run.url = formatEndpoint(trace.document.url) || run.url;
	}
	let scan = run.scans.get(trace.scanId);
	if (!scan) {
		scan = {
			id: trace.scanId, nodes: new Map(), segments: new Map(), chunks: new Set(),
			chunkCount: 1, nodeCount: 0, segmentCount: 0, truncated: false,
		};
		run.scans.set(scan.id, scan);
	}
	scan.chunks.add(number(trace.chunkIndex));
	scan.chunkCount = Math.max(scan.chunkCount, number(trace.chunkCount));
	scan.nodeCount = Math.max(scan.nodeCount, number(trace.nodeCount));
	scan.segmentCount = Math.max(scan.segmentCount, number(trace.segmentCount));
	scan.truncated ||= trace.truncated === true || event.contentTraceTruncated === true;
	for (const node of array(trace.nodes)) {
		if (!node || !text(node.id)) continue;
		scan.nodes.set(node.id, {
			id: text(node.id), tag: text(node.tag, 40), path: text(node.path, 4_096),
			revision: number(node.revision), text: contentText(node.text),
		});
	}
	for (const item of array(trace.segments)) {
		if (!item || !text(item.id)) continue;
		const previous = scan.segments.get(item.id);
		const targets = new Map((previous?.targets || []).map((target) => [targetKey(target), target]));
		for (const target of array(item.targets)) {
			if (!target || !text(target.nodeId)) continue;
			const safeTarget = {
				nodeId: text(target.nodeId), partIndex: number(target.partIndex), partCount: number(target.partCount),
			};
			targets.set(targetKey(safeTarget), safeTarget);
		}
		scan.segments.set(item.id, {
			id: text(item.id), text: contentText(item.text),
			sourceLanguage: text(item.sourceLanguage, 20), targetLanguage: text(item.targetLanguage, 20),
			cache: item.cache === "memory" ? "memory" : "pending", targets: [...targets.values()],
		});
	}
}

function targetKey(target) {
	return `${target.nodeId}:${target.partIndex}`;
}

function acceptBatch(run, event) {
	if (!text(event.batchId)) return;
	let batch = run.batches.get(event.batchId);
	if (!batch) {
		batch = { id: text(event.batchId), index: number(event.batchIndex), ids: new Set(), hits: new Set(), misses: new Set() };
		run.batches.set(batch.id, batch);
	}
	for (const id of array(event.segmentIds)) if (text(id)) batch.ids.add(id);
	for (const id of array(event.cacheHitIds)) if (text(id)) batch.hits.add(id);
	for (const id of array(event.cacheMissIds)) if (text(id)) batch.misses.add(id);
}

function canonicalId(run, id) {
	const visited = new Set();
	while (run.aliases.has(id) && !visited.has(id)) {
		visited.add(id);
		id = run.aliases.get(id);
	}
	return id;
}

function decorateSegment(run, segment) {
	const canonical = canonicalId(run, segment.id);
	const batches = [...run.batches.values()].filter((batch) => batch.ids.has(canonical));
	const requests = run.requests.filter((request) =>
		[...request.rootSegmentIds, ...request.segmentIds].includes(canonical),
	);
	let route = "等待批次记录";
	if (segment.cache === "memory") route = "本次页面缓存";
	else if (batches.some((batch) => batch.hits.has(canonical))) route = "持久缓存";
	else if (requests.length) route = `DeepSeek · ${requests.length} 次请求`;
	else if (batches.some((batch) => batch.misses.has(canonical))) route = "已排队发送";
	return { ...segment, canonicalId: canonical, route, batchIds: batches.map((batch) => batch.id), requests };
}

function finishRun(run) {
	const scans = [...run.scans.values()].map((scan) => {
		const segments = [...scan.segments.values()].map((segment) => decorateSegment(run, segment));
		const nodes = [...scan.nodes.values()].map((node) => ({
			...node,
			key: `${scan.id}:${node.id}:${node.revision}`,
			scanId: scan.id,
			segments: segments.filter((segment) => segment.targets.some((target) => target.nodeId === node.id))
				.sort((left, right) => partIndex(left, node.id) - partIndex(right, node.id)),
		}));
		return {
			id: scan.id, nodes, segments,
			partial: scan.truncated || scan.chunks.size < scan.chunkCount ||
				nodes.length < scan.nodeCount || segments.length < scan.segmentCount,
		};
	});
	const nodes = scans.flatMap((scan) => scan.nodes);
	return {
		id: run.id, tabId: run.tabId, time: run.time, title: run.title, url: run.url, nodes,
		segments: scans.flatMap((scan) => scan.segments),
		requests: run.requests, batchCount: run.batches.size,
		scanCount: scans.length, partial: scans.some((scan) => scan.partial),
		searchText: [run.id, run.tabId, run.title, run.url, ...nodes.flatMap((node) => [node.path, node.text])].join(" ").toLowerCase(),
	};
}

export function partIndex(segment, nodeId) {
	return segment.targets.find((target) => target.nodeId === nodeId)?.partIndex ?? 0;
}

export function createDebugTraces(events, requests) {
	const runs = new Map();
	for (const event of normalizeDebugEvents(events)) {
		if (!text(event.runId)) continue;
		if (!runs.has(event.runId)) runs.set(event.runId, createRun(event));
		const run = runs.get(event.runId);
		acceptPlan(run, event);
		acceptBatch(run, event);
		for (const alias of array(event.contentAliases)) {
			if (text(alias?.segmentId) && text(alias?.canonicalSegmentId)) {
				run.aliases.set(alias.segmentId, alias.canonicalSegmentId);
			}
		}
	}
	for (const request of requests) {
		const run = runs.get(request.runId);
		if (run) run.requests.push(request);
	}
	return [...runs.values()].map(finishRun).reverse();
}

export function exportDebugTrace(run, retention = {}) {
	return {
		runId: run.id, tabId: run.tabId, title: run.title, url: run.url,
		partial: run.partial || retention.droppedEvents > 0,
		retention: {
			scope: "retained-scans", droppedEvents: number(retention.droppedEvents),
			maxEvents: number(retention.maxEvents), maxBytes: number(retention.maxBytes),
		},
		nodes: run.nodes.map(({ id, scanId, tag, path, revision, text: source }) =>
			({ id, scanId, tag, path, revision, text: source }),
		),
		segments: run.segments.map(({ requests, ...segment }) =>
			({ ...segment, requestIds: requests.map((request) => request.id) }),
		),
		requests: run.requests.map((request) => ({
			id: request.id, batchId: request.batchId, modelRequestId: request.modelRequestId,
			parentModelRequestId: request.parentModelRequestId, attempt: request.attempt,
			recoveryDepth: request.recoveryDepth, segmentIds: request.segmentIds,
			rootSegmentIds: request.rootSegmentIds, capture: request.capture,
			fields: Object.fromEntries(request.fields.filter((field) => field.key !== "requestPayload")
				.map((field) => [field.key, field.value])),
		})),
	};
}
