/** 监听属性与它们触发的恢复/排除规则，集中供 MutationMonitor 使用。 */
export const GENERATED_ATTRIBUTES = new Set([
	"aria-describedby",
	"data-bt-description-id",
	"data-bt-generated-owned",
	"data-bt-owned",
	"data-bt-presentation",
	"data-bt-presentation-run",
	"data-bt-run",
	"data-bt-source",
	"data-bt-translation",
	"data-bt-translation-lang",
	"id",
]);
export const EXCLUSION_ATTRIBUTES = new Set(["aria-hidden", "inert", "translate"]);

const OBSERVED_ATTRIBUTES = [
	...GENERATED_ATTRIBUTES,
	"aria-hidden",
	"aria-label",
	"class",
	"data-hovercard-type",
	"hidden",
	"inert",
	"lang",
	"role",
	"style",
	"translate",
];

export function getObservedAttributes(hostname) {
	return hostname === "github.com" ? [...OBSERVED_ATTRIBUTES, "href"] : OBSERVED_ATTRIBUTES;
}
