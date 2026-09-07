const MAX_PACKET_BYTES = 192 * 1_024;
const PACKET_METADATA_RESERVE = 16 * 1_024;
const MAX_ARRAY_ITEMS = 1_000;
const MAX_TARGETS_PER_ENTRY = 256;
const MAX_TEXT_CHARACTERS = 50_000;
const MAX_TEXT_BYTES = 96 * 1_024;
const encoder = new TextEncoder();

/** 原文和分片分别切包；接收方通过 scanId、nodeId 还原关系，避免重复存储长原文。 */
export function createContentTracePackets({ scanId, nodes, segments, truncated = false }) {
	const chunks = [];
	let chunk = { nodes: [], segments: [] };
	let bytes = PACKET_METADATA_RESERVE;
	const append = (field, item) => {
		const itemBytes = encodedSize(item);
		if (bytes + itemBytes > MAX_PACKET_BYTES || chunk[field].length >= MAX_ARRAY_ITEMS) {
			chunks.push(chunk);
			chunk = { nodes: [], segments: [] };
			bytes = PACKET_METADATA_RESERVE;
		}
		chunk[field].push(item);
		bytes += itemBytes;
	};
	for (const node of nodes) {
		const text = limitTraceText(node.text);
		truncated ||= text !== node.text;
		append("nodes", { ...node, text });
	}
	for (const segment of segments) {
		const text = limitTraceText(segment.text);
		truncated ||= text !== segment.text;
		for (let offset = 0; offset < segment.targets.length; offset += MAX_TARGETS_PER_ENTRY) {
			append("segments", {
				...segment,
				text,
				targets: segment.targets.slice(offset, offset + MAX_TARGETS_PER_ENTRY),
			});
		}
	}
	if (chunk.nodes.length > 0 || chunk.segments.length > 0) chunks.push(chunk);
	return chunks.map((entries, chunkIndex) => ({
		version: 1,
		scanId,
		...entries,
		nodeCount: nodes.length,
		segmentCount: segments.length,
		chunkIndex,
		chunkCount: chunks.length,
		...(truncated ? { truncated: true } : {}),
	}));
}

function limitTraceText(value) {
	let text = value.slice(0, MAX_TEXT_CHARACTERS);
	while (encodedSize(text) > MAX_TEXT_BYTES) {
		text = text.slice(0, Math.floor(text.length * 0.8));
	}
	return text;
}

function encodedSize(value) {
	return encoder.encode(JSON.stringify(value)).byteLength;
}
