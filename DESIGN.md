# Design System — Web Translate

## Product Context

- **What this is:** A Chrome extension that inserts each translation directly below its source text and keeps translating newly loaded page content.
- **Who it is for:** People who want a one-click bilingual reading tool and developers learning how the extension works.
- **Project type:** Compact extension utility and settings page.
- **Primary job:** Configure one Provider once, then translate or restore the current page with the toolbar icon.

## Aesthetic Direction

- **Direction:** Botanical Utility.
- **Decoration:** Minimal and intentional. Plant imagery appears only in the product mark, bilingual sample, and connection state.
- **Mood:** Light, direct, and local-first. It should feel like a small native tool, not a SaaS dashboard or a themed admin panel.
- **Reference:** [RepoBar](https://repobar.app/) for glanceable state, direct actions, and restrained information hierarchy.
- **Memorable element:** A compact `A/文` sign grows from the sprout, combining the open-source seedling metaphor with an immediate translation cue.

### Safe choices

- A single centered settings column keeps the setup form familiar and readable.
- Native radio controls inside compact selection blocks keep Provider configuration accessible.
- Secondary features use disclosures and a separate debug view instead of competing with the primary action.

### Deliberate risks

- Botanical language is used as a product metaphor, but literal decoration is limited so the UI does not become a themed dashboard.
- The main surface has one clipped leaf-like corner. Other controls stay geometrically quiet so this remains a recognizable signature.
- The icon uses a compact `A/文` sign because the sprout alone does not communicate translation. The sign is integrated into the stem so it still reads as one product mark rather than a generic category icon.

## First-run Path

The initial viewport must contain, in this order:

1. Product identity and loaded version.
2. Default Provider, initially DeepSeek.
3. Three common Providers and one compact **更多服务** entry.
4. API Key.
5. One primary action: **保存并测试**.
6. One factual privacy line.

The default model, automatic language direction, dynamic translation, and concurrency are already usable. Keep them in the second layer. Debugging and usage must never sit between the API Key and the primary action.

## Typography

- **Display and body:** `Avenir Next`, then `PingFang SC`, `Hiragino Sans GB`, and `Microsoft YaHei`.
- **Code and data:** `SFMono-Regular`, then `Consolas` and `Liberation Mono`.
- **Loading:** Local system fonts only. Manifest V3 pages must not depend on remote font files.
- **Scale:** 11px metadata, 12–14px controls and body, 21px section heading, 30–40px page heading.

## Color

- **Approach:** Restrained; green communicates brand, readiness, and focus.
- **Paper:** `#f3f5ed`.
- **Surface:** `#fffefb`.
- **Ink:** `#17231b`.
- **Secondary ink:** `#58655d`.
- **Pine:** `#244936`; dark `#183126`.
- **Leaf:** `#4d7354`; light `#91b56e`.
- **Seed:** `#dce9aa`.
- **Lines:** `#d9dfd3`; strong `#b9c5b6`.
- **Error:** `#a43f35`; soft surface `#faece8`.

Color is not decorative. Use seed for the mark, pine for the primary action and focus, leaf-light for small state dots, and red only for errors.

## Spacing

- **Base unit:** 4px.
- **Density:** Compact and comfortable.
- **Scale:** 4, 8, 12, 16, 20, 24, 32, 40, 56, 72px.
- Keep the API Key and primary action visible without scrolling at a 768px viewport height.

## Layout

- **Approach:** Grid-disciplined single column.
- **Maximum width:** 720px.
- **Breakpoints:** 700px for stacked content; 480px for compact navigation and disclosures.
- **Surfaces:** One primary form surface. Do not create a card for every subsection.
- **Provider selection:** A two-column 2×2 radio grid for DeepSeek, OpenAI, Gemini, and more. Secondary Providers expand only on demand; switch to one column below 520px.
- **Radius:** 5–8px for controls, 14px for the primary action corner, and one 24px corner on the main surface.
- **Popup:** Use one vertical input/output language path with a compact side action, followed by a service row and quiet utility footer. Avoid mirrored language cards, a swap button, a full-width hero button, feature grids, and app-like bottom navigation.

## Icon

- Master symbol: two solid leaves, one stem, and a compact `A/文` translation sign.
- Manifest assets: exact 16, 32, 48, and 128px PNG files.
- The 16px version is a dedicated pixel drawing: the sprout sits above separate `A` and `文` glyphs instead of shrinking the master artwork.
- Glyphs use SVG geometry rather than font text so they remain stable across platforms.
- No leaf veins, shadows, gradients, globes, or translation arrows.
- Keep the SVG sources beside the PNG exports.

## Motion

- **Approach:** Minimal and functional.
- **Duration:** 80–130ms for controls; up to 700ms only for the initial loading mark.
- Respect `prefers-reduced-motion`.
- Do not animate the toolbar icon or add ambient background motion.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-08-05 | Replaced the settings dashboard with a 720px single-column setup | Keeps the API Key and primary action in the first viewport |
| 2026-08-05 | Combined save and connection test into one primary action | Removes the only unnecessary decision in first-run setup |
| 2026-08-05 | Created the double-line sprout icon | Connects the open-source sapling metaphor with bilingual line placement |
| 2026-08-05 | Replaced the abstract text lines with an `A/文` sign | Makes translation recognizable without implying English-only direction |
| 2026-08-05 | Moved debug into a dedicated view | Preserves rich diagnostics without slowing initial configuration |
| 2026-08-05 | Replaced the Provider dropdown with a compact 2×2 radio grid | Makes service differences glanceable while keeping secondary services out of the default path |
| 2026-08-05 | Kept the request-first debug panel self-built with zero new dependencies | Existing Vue primitives and Chrome APIs cover filtering, search, disclosure, bottom-following, safe JSON copy, and live Port updates; avoiding a log-viewer dependency keeps the Manifest V3 package small and the metadata security boundary easy to audit |
| 2026-08-06 | Made the Popup a compact language-direction tool | Gives input and output selection first-class utility while avoiding the mirrored cards, oversized button, and bottom navigation used by established translation extensions |
