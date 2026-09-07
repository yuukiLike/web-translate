import { DEBUG_LIMITS } from "./constants.js";
import { estimateStorageBytes } from "./utilities.js";

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const identifier = (value) => typeof value === "string" ? value.slice(0, 100) : "";
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function safeIdentifiers(value) {
	if (!Array.isArray(value)) return [];
	return value.slice(0, DEBUG_LIMITS.maxContentItems).map(identifier).filter(Boolean);
}

export function createSafeContentAliases(value) {
	if (!Array.isArray(value)) return undefined;
	const aliases = value.slice(0, DEBUG_LIMITS.maxContentItems).flatMap((entry) => {
		if (!isRecord(entry)) return [];
		const segmentId = identifier(entry.segmentId);
		const canonicalSegmentId = identifier(entry.canonicalSegmentId);
		return segmentId && canonicalSegmentId ? [{ segmentId, canonicalSegmentId }] : [];
	});
	return aliases.length ? aliases : undefined;
}

export function createSafeContentTrace(value) {
	if (!isRecord(value) || value.version !== 1 || !identifier(value.scanId)) return undefined;
	const trace = {
		version: 1,
		scanId: identifier(value.scanId),
		nodes: [],
		segments: [],
		nodeCount: count(value.nodeCount),
		segmentCount: count(value.segmentCount),
	};
	let truncated = value.truncated === true;
	if (isRecord(value.document)) {
		trace.document = { title: typeof value.document.title === "string" ? value.document.title.slice(0, 300) : "" };
		try {
			const url = new URL(value.document.url);
			if (["http:", "https:"].includes(url.protocol)) trace.document.url = `${url.origin}${url.pathname}`.slice(0, 2_048);
		} catch {
			// A document label is optional; malformed URLs never prevent translation.
		}
	}
	if (Number.isSafeInteger(value.chunkIndex)) trace.chunkIndex = count(value.chunkIndex);
	if (Number.isSafeInteger(value.chunkCount)) trace.chunkCount = count(value.chunkCount);
	for (const [field, sanitize] of [["nodes", sanitizeNode], ["segments", sanitizeSegment]]) {
		const source = Array.isArray(value[field]) ? value[field] : [];
		let bytes = 0;
		for (const entry of source.slice(0, DEBUG_LIMITS.maxContentItems)) {
			const safe = sanitize(entry);
			if (!safe) {
				truncated = true;
				continue;
			}
			const entryBytes = estimateStorageBytes(safe);
			if (bytes + entryBytes > DEBUG_LIMITS.maxContentTraceBytes / 2 - 1_024) {
				truncated = true;
				break;
			}
			bytes += entryBytes + 1;
			trace[field].push(safe);
			truncated ||= safe.text.length !== entry.text.length;
			if (field === "segments") truncated ||= safe.targets.length !== (Array.isArray(entry.targets) ? entry.targets.length : 0);
		}
		truncated ||= trace[field].length < source.length;
	}
	if (truncated) trace.truncated = true;
	return trace;
}

function sanitizeNode(value) {
	if (!isRecord(value) || !identifier(value.id) || typeof value.text !== "string") return undefined;
	return {
		id: identifier(value.id),
		tag: typeof value.tag === "string" && /^[a-z][a-z0-9-]{0,40}$/iu.test(value.tag) ? value.tag : "unknown",
		path: typeof value.path === "string" ? value.path.slice(0, 4_096) : "",
		revision: count(value.revision),
		text: value.text.slice(0, 50_000),
	};
}

function sanitizeSegment(value) {
	if (!isRecord(value) || !identifier(value.id) || typeof value.text !== "string") return undefined;
	if (!["en", "zh"].includes(value.sourceLanguage) || !["en", "zh"].includes(value.targetLanguage)) return undefined;
	const targets = Array.isArray(value.targets) ? value.targets : [];
	return {
		id: identifier(value.id),
		text: value.text.slice(0, 50_000),
		sourceLanguage: value.sourceLanguage,
		targetLanguage: value.targetLanguage,
		cache: value.cache === "memory" ? "memory" : "pending",
		targets: targets.slice(0, DEBUG_LIMITS.maxContentItems).flatMap((target) => {
			if (!isRecord(target) || !identifier(target.nodeId)) return [];
			return [{ nodeId: identifier(target.nodeId), partIndex: count(target.partIndex), partCount: count(target.partCount) }];
		}),
	};
}
