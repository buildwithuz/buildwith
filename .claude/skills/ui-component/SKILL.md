---

name: ui-component
description: Build or change UI in packages/ui or apps/web following the buildwith.uz design system (tokens, Radix primitives, accessibility, dark mode, Latin/Cyrillic, no-JS fallback). Use for any visual or interaction change.
---

# UI work

## Design language

Calm, warm, typographic. It should feel like a well-made book that happens to be fast, not like a dashboard.

- **Colors** (tokens in `packages/ui/src/tokens.css`, never raw hex in components):
  - `paper` warm off-white background, `ink` near-black text, `muted` secondary text, `line` hairline borders.
  - One accent: **`lapis`** (Samarkand tile blue) for links, focus and primary actions; **`turquoise`** only for success/positive states.
  - `danger`, `warning` for states. Dark mode has its own warm-dark values, not inverted colors.
- **Type** (self-hosted, no CDN): UI sans (Inter, supports oʻ gʻ ʼ), reading serif for article bodies (Source Serif 4), mono for code
  and counters (JetBrains Mono). Scale: 12/14/16/18/22/28/36. Article body 19 px / 1.7, max 68ch.
- **Space** 4 px grid (`1`=4 px … `16`=64 px). Lists are dense (HN-like); articles and profiles are spacious.
- **Shape:** radius 6 px (controls), 10 px (cards). Hairline borders, almost no shadows.
- **Motion:** 120–180 ms ease-out, only for state changes. Respect `prefers-reduced-motion`.
- **Ornament:** a subtle girih/ikat pattern is allowed only in empty states, 404 and the footer. Never behind text.
- **Icons:** Lucide, 16/20 px, stroke 1.75.

## Rules

1. Components live in `packages/ui/src/components/<Name>/` with `<Name>.tsx`, `<Name>.stories.tsx`, `<Name>.test.tsx`.
2. Interactive primitives (dialog, menu, popover, tabs, tooltip, combobox) wrap **Radix**. Don't hand-roll focus management.
3. **Accessibility:** keyboard reachable, visible focus ring (`ring-lapis`), labels on every control, contrast ≥ 4.5:1 (check both themes),
   images need `alt`, icons-only buttons need `aria-label`.
4. **No-JS fallback:** forms are real `<form>`s via React Router `<Form>`; disclosure via `<details>` where possible.
5. **i18n:** no hard-coded strings; take text via props or `t()`. Leave room for Russian, which runs ~30% longer.
6. **Latin/Cyrillic:** user content passes through `<Translit>`; test the story in both scripts.
7. **Responsive:** design at 360 px first, then 768 and 1200.
8. Keyboard shortcuts (j/k, l like, r reply, n new note, / search, ⌘K command palette) are registered through `useShortcut` so they're listed in the `?` help dialog.

## Done when

- Story covers: default, loading, empty, error, long text (Russian), Cyrillic, dark mode.
- Vitest + Testing Library test for behaviour; axe check in the story passes.
- Screenshots (light + dark, 360 px + desktop) attached to the PR.
