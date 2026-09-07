# Design System — Web Translate

## Product Context

- **What this is:** A Chrome extension that inserts each translation directly below its source text and keeps translating newly loaded page content.
- **Who it is for:** People who want a one-click bilingual reading tool and developers learning how the extension works.
- **Project type:** Compact extension utility and settings page.
- **Primary job:** Configure one Provider once, then translate or restore the current page with the toolbar icon.

## Aesthetic Direction

- **Direction:** Facing Pages — 对页.
- **Identity:** An open book with a turning page, drawn in warm paper and sage on forest ink. The clear central gutter connects the two languages without placing tiny letters inside the mark.
- **Mood:** A carefully typeset reading tool. Quiet materials, generous language typography, precise controls, and a clear reading order carry the character.
- **Decoration:** The book silhouette belongs to the product identity. Actions use small directional strokes; they do not repeat the brand mark.
- **Scope:** The popup and shared product mark use this direction. The settings form retains its existing layout and utility colors; remaining botanical sample decorations are legacy settings details.

### Safe choices

- A single centered settings column keeps the setup form familiar and readable.
- Native radio controls inside compact selection blocks keep Provider configuration accessible.
- Secondary features use disclosures and a separate debug view instead of competing with the primary action.

### Deliberate risks

- The destination language uses a large local serif face, giving the actual reading choice the strongest typographic emphasis.
- The book icon communicates bilingual reading through paired pages. Its silhouette, rather than microtext or an extra translation badge, must survive at toolbar size.
- Warm paper and a very light card shadow give the popup a material quality. Keep the effect subtle and the control contrast explicit.

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

- **Body and controls:** `Avenir Next`, then `PingFang SC`, `Hiragino Sans GB`, and `Microsoft YaHei`.
- **Popup identity and destination:** `Iowan Old Style`, `Palatino Linotype`, `Songti SC`, `Noto Serif CJK SC`, and `SimSun`, then the platform serif fallback. The source stays in the UI sans face.
- **Code and data:** `SFMono-Regular`, then `Consolas` and `Liberation Mono`.
- **Loading:** Local system fonts only. Manifest V3 pages must not depend on remote font files.
- **Popup scale:** 10px metadata, 11px labels and status, 14px primary action and provider, 21px identity and source, 28px destination.
- **Settings scale:** 11px metadata, 12–14px controls and body, 21px section heading, 30–40px page heading.

## Color

- **Approach:** Restrained; green communicates brand, readiness, and focus. Unsupported pages use neutral text; red is reserved for execution and connection failures.

### Popup and identity

- **Paper / surface:** `#f4f2ec` / `#fffefa`.
- **Ink / secondary ink:** `#233d34` / `#667069`.
- **Action / hover:** `#234c3c` / `#18382c`.
- **Lines / strong lines:** `#dcded4` / `#b8c2b6`.
- **Error:** `#a0392d`.
- **Icon pages:** `#f7f3e8`, `#afc4aa`, and `#e0e9d4` on `#233d34`.

### Existing settings palette

- **Paper:** `#f3f5ed`.
- **Surface:** `#fffefb`.
- **Ink:** `#17231b`.
- **Secondary ink:** `#58655d`.
- **Pine:** `#244936`; dark `#183126`.
- **Leaf:** `#4d7354`; light `#91b56e`.
- **Seed:** `#dce9aa`.
- **Lines:** `#d9dfd3`; strong `#b9c5b6`.
- **Error:** `#a43f35`; soft surface `#faece8`.

Use pine for primary actions and focus, small state dots for readiness, and red only for errors. Keep the shared icon colors independent of settings theme tokens.

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
- **Popup radius:** 14px reading surface, 8px primary action; the book icon has its own 16/64 corner proportion.
- **Popup:** A 360px surface with 22px side margins. Product identity comes first, then one vertical input/output path, its explanation, a 50px translation action, and live status. A separate service row and quiet utility footer complete the view.
- **Popup controls:** Native selects retain labels, keyboard behavior, disabled semantics, and visible focus. The vertical rail is decorative; do not add a swap control to it. Let long provider names, models, and error messages wrap.
- **Popup states:** Unsupported pages keep language settings usable and show a neutral reason. Real failures retain red text. Busy actions retain contrast, lock language changes, and expose progress through both text and `aria-busy`.

## Icon

- Master symbol: two facing book pages with one page turning across the right side. A clear vertical gutter keeps the silhouette legible.
- Manifest assets: exact 16, 32, 48, and 128px PNG files.
- The 16px source uses a wider two-pixel gutter and simplified page geometry instead of shrinking the master drawing.
- Use solid SVG paths, without font glyphs, gradients, or baked-in shadows.
- Popup and Options both reference `chrome-extension/assets/icons/icon.svg`; do not duplicate the geometry in Vue or CSS.
- Keep both SVG sources beside the PNG exports. On macOS, run `npm run build:icons` after editing them and commit the SVGs and all four PNGs together. The exporter uses system `sips`, stages all sizes, and validates their PNG dimensions before replacing assets. Other build commands do not require macOS.

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
| 2026-09-07 | Replaced the sprout with the Facing Pages identity and rebuilt the popup hierarchy | Connects the product to bilingual reading through a custom book silhouette, expressive destination typography, and a vertical language path; separates neutral unavailability from actual failures |
| 2026-09-07 | Shared one SVG across product surfaces and added a checked icon export command | Keeps toolbar assets and UI branding consistent without duplicated drawing code or a new dependency |
