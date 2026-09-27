---
name: Orbital Works
description: A real-time satellite tracker and spacecraft hardware console on a pure-black field, set entirely in Overpass Mono.
colors:
  live-green: "#44ff44"
  console-accent: "#66aaff"
  estimate-amber: "#ffae4a"
  danger: "#cc4444"
  warning: "#cc6633"
  void-black: "#000000"
  console-surface: "#0a0a0a"
  console-panel: "#1a1a1a"
  console-border: "#555555"
  console-border-hover: "#aaaaaa"
  console-text: "#ffffff"
  console-text-muted: "#bbbbbb"
  console-text-ghost: "#777777"
  ink: "#f2f1ec"
  ink-2: "rgba(242, 241, 236, 0.72)"
  ink-3: "rgba(242, 241, 236, 0.46)"
  hairline: "rgba(242, 241, 236, 0.14)"
  glass-panel: "rgba(4, 5, 7, 0.72)"
  caption-scrim: "rgba(0, 0, 0, 0.62)"
  mli-silver: "#c9cbce"
  solar-substrate: "#b3461f"
  solar-cell: "#0b0e1b"
  mirror-coat: "#f3f1ea"
typography:
  display:
    fontFamily: "Overpass Mono, ui-monospace, monospace"
    fontSize: "clamp(28px, min(3.3vw, 5vh), 46px)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Overpass Mono, ui-monospace, monospace"
    fontSize: "clamp(18px, 1.9vw, 26px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Overpass Mono, ui-monospace, monospace"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "Overpass Mono, ui-monospace, monospace"
    fontSize: "34px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Overpass Mono, ui-monospace, monospace"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Overpass Mono, ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Overpass Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  provenance-tag:
    fontFamily: "Overpass Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 500
    letterSpacing: "0.06em"
  console-window-title:
    fontFamily: "Overpass Mono, Courier New, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "1px"
rounded:
  none: "0px"
  chip: "2px"
  control: "9px"
  dock: "14px"
  pin: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  edge-phone: "16px"
  edge: "32px"
components:
  button-cta:
    backgroundColor: "{colors.live-green}"
    textColor: "{colors.void-black}"
    typography: "{typography.body-small}"
    rounded: "{rounded.none}"
    padding: "11px 16px 11px 18px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-small}"
    rounded: "{rounded.none}"
    padding: "7px 12px"
  button-ghost-disabled:
    textColor: "{colors.ink-3}"
  button-exit:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 14px"
  chip-provenance-pub:
    textColor: "{colors.live-green}"
    typography: "{typography.provenance-tag}"
  chip-provenance-der:
    textColor: "{colors.ink-2}"
    typography: "{typography.provenance-tag}"
  chip-provenance-est:
    textColor: "{colors.estimate-amber}"
    typography: "{typography.provenance-tag}"
  label-3d-chip:
    backgroundColor: "{colors.caption-scrim}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 6px"
  label-3d-chip-lit:
    textColor: "{colors.ink}"
  caption-figure:
    backgroundColor: "{colors.caption-scrim}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 7px"
  inspector-panel:
    backgroundColor: "{colors.glass-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px 18px 14px"
    width: "330px"
  chapter-rail:
    textColor: "{colors.ink-3}"
    height: "64px"
    padding: "0 20px"
  chapter-rail-item:
    textColor: "{colors.ink-3}"
    typography: "{typography.body-small}"
    padding: "12px 14px"
  chapter-rail-item-active:
    textColor: "{colors.ink}"
  console-button:
    backgroundColor: "transparent"
    textColor: "{colors.console-text}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 10px"
  console-button-active:
    textColor: "{colors.console-accent}"
  console-dock-button:
    backgroundColor: "transparent"
    textColor: "{colors.console-text-ghost}"
    rounded: "{rounded.control}"
    size: "27px"
  console-window-titlebar:
    backgroundColor: "{colors.console-surface}"
    textColor: "{colors.console-text-ghost}"
    typography: "{typography.console-window-title}"
    padding: "4px 8px"
---

# Design System: Orbital Works

## Overview

**Creative North Star: "The Instrument Console"**

Orbital Works is a black-field instrument. Everything sits on pure black (#000), is set in one monospace family, Overpass Mono, and is drawn with grey hairlines rather than filled surfaces. Colour is scarce and it means something. The theme's live green marks what is active, measured, or confirmed. Amber marks what is estimated. The coloured fields that remain belong to the objects themselves, whether that is a satellite's ground track or the Roman observatory's silver blankets and red-orange solar substrate. The interface never supplies decorative colour of its own.

The system has two registers built from the same materials. The **tracker console** is dense: draggable windows with a thin titlebar, 9 to 12px text, a floating blurred dock, and twelve interchangeable themes behind CSS variables on `:root`. The **Roman explorer** is the landing view and sits over the whole app. It uses the same black, the same family and the same live green at a reading scale: 14.5px body, 46px chapter headlines, square outlined controls, and a full-bleed three.js stage whose labels are drawn in the interface's own type. Density changes between the two registers. The vocabulary does not.

Hardware must read as hardware. The 3D stage uses ACES filmic tone mapping, a warm key light (0xfff3e2), a cool fill and a near-black ambient. Surfaces are physically based materials in their flight colours. Provenance is set as type: every figure the explorer shows carries a PUB, DER or EST tag in the text itself.

**Key Characteristics:**
- Pure black ground, with no tinted background washes behind the interface.
- One family, Overpass Mono, for every role from the 46px display size down to the 10px tags.
- Live green (#44ff44 in the default theme) is the only UI accent in the explorer, and it always means "active, measured, confirmed".
- Structure comes from hairlines (1px, grey or 14% ink) and scrims, never from filled cards.
- 3D objects appear in their real flight materials. The UI palette never tints the hardware.
- Provenance tags (PUB / DER / EST) sit inline with the numbers they qualify.

## Colors

Mostly black and warm off-white, one functional green, one amber reserved for estimates, and the hardware's own colours.

### Primary
- **Live Green** (`live-green`): the theme's `--live` variable, defined in `src/styles/global.css` and overridden by every theme in `src/themes/builtins.ts` (for example #22aa22 in Light and #cc6622 in Redshift). In the console it marks live and alive states: rotator on-target, rig connected, received log lines, alive satellites. In the explorer it is the forward CTA fill, the active rail underline, the selected part row, the current light-path stop, the detector footprint outlines, the PUB tag, the focus ring, text selection, slider and checkbox accent, the caption rule and the mission-status dot.

### Secondary
- **Console Accent Blue** (`console-accent`, `--accent`): the console's selection colour. The shared Button's `active` state and the dock's seated active pill (at 15% mix) use it. The explorer does not use it.

### Tertiary
- **Estimate Amber** (`estimate-amber`, the explorer's `--est`): only for the EST provenance tag, the EST segment of the provenance bar (at 0.8 opacity), and the "Unresolved." lead of a source-conflict note, which sits on a 7% amber wash.
- **Danger / Warning** (`danger`, `warning`, with `--danger-bright` #ff6666 and `--warning-bright` #ff9944): console alerts and destructive hovers.
- **Flight colours** (3D materials in `src/roman/model.ts`, not CSS): **MLI Silver** (`mli-silver`), a crinkled, low-sheen multi-layer insulation blanket (metalness 0.85, roughness 0.4, normal-mapped foil) with barrel and visor variants of #b7b9bc and #c2c4c7 over near-black interiors; **Solar Substrate** (`solar-substrate`) under a 16 × 12 grid of **Solar Cells** (`solar-cell`, stepped from rgb(11,14,27) to rgb(14,17,30)); **Mirror Coat** (`mirror-coat`, metalness 1, roughness 0.035). The light path renders as a pale blue-white trail (0xdde9ff) with a white pulse. The coronagraph's path and the comms beam use green (0x44ff44), and the selection emissive uses 0x8cff8c.

### Neutral
- **Void Black** (`void-black`): the page, the 3D scene background, the CTA text colour, and the phone rail's opaque fill.
- **Console Surface / Panel** (`console-surface`, `console-panel`): window titlebars, modals and the dock base (at 72% mix); inset panels.
- **Console Border / Hover** (`console-border`, `console-border-hover`): 1px window, button and field outlines.
- **Console Text ladder** (`console-text` → `console-text-muted` → `console-text-ghost`, with `--text-dim` #eee and `--text-faint` #999 between): primary through ghost text in the tracker.
- **Ink ladder** (`ink`, `ink-2`, `ink-3`): the explorer's text. It is a warm off-white at 100%, 72% and 46%, used for headlines and values, then body copy, then labels, axes and inactive rail items.
- **Hairline** (`hairline`): every explorer rule, outline and unfilled track.
- **Glass Panel** (`glass-panel`): the inspector, with a 12px backdrop blur.
- **Caption Scrim** (`caption-scrim`): the backing for 3D label chips and in-figure captions, so text reads over any star.

### Named Rules
**The Live Means Live Rule.** Green is never decoration. If an element is green, it is active, measured, selected, or published. Everything else is ink or grey.

**The Hardware Keeps Its Colours Rule.** The object's own materials (silver MLI, near-black cells on red-orange substrate, bare mirror) are the only saturated fields in the 3D stage. The UI palette never tints the model, apart from the green selection emissive.

**The Amber Is For Guesses Rule.** Estimate amber marks estimated or conflicting values and nothing else. It is not a warning colour in the explorer.

## Typography

**Display Font:** Overpass Mono (with ui-monospace, monospace)
**Body Font:** Overpass Mono
**Label/Mono Font:** Overpass Mono

**Character:** A single engineered monospace carries every role. Hierarchy comes from size, weight (400 / 500 / 600) and negative tracking at large sizes, never from a second family. The console loads `/textures/ui/overpass-mono.ttf` at 400. The explorer loads the variable `/fonts/overpass-mono-var-latin.woff2` (300 to 700) under a local alias.

### Hierarchy
- **Display** (600, clamp(28px, min(3.3vw, 5vh), 46px), 1.02, -0.035em, balanced wrap): explorer chapter headlines; 26px on phones.
- **Headline** (600, clamp(18px, 1.9vw, 26px), 1.12, -0.02em): the explorer masthead title; 16px on phones.
- **Title** (600, 19px, 1.15, -0.02em): the inspector's part name.
- **Figure** (500, 34px, 1, -0.03em): a chapter's single hero number (28px on phones). The ledger variant is 500 at 20px, -0.02em, tabular numerals.
- **Body** (400, 14.5px, 1.5, max 46ch, pretty wrap): explorer chapter copy; 13.5px on phones.
- **Body Small** (400, 12.5px): rail items, list rows, ladder rows, inspector blurb, event text. The console's working sizes are 10 to 12px, most often 10px and 11px.
- **Label** (400, 11px): 3D label chips, captions, source lines, the provenance meter, ledger direction words.
- **Provenance Tag** (500, 10px, 0.06em, raised 0.1em): PUB / DER / EST.
- **Console Window Title** (400, 11px, 1px tracking, uppercase, ghost grey): draggable-window titlebars only.

### Named Rules
**The One Family Rule.** Overpass Mono is the only typeface. Do not introduce a second family for display or body text.

**The Tags Are Type Rule.** Provenance tags are set inline at 10px/500 in their tag colour, next to the value they qualify, with the tag's full meaning in an `<abbr title>`. They are part of the line and do not go in footnotes.

**The Tabular Figures Rule.** Any column of numbers (fact tables, ladder values, ledger values) uses `font-variant-numeric: tabular-nums` and is right-aligned where it forms a column.

## Layout

**Explorer.** A full-viewport fixed stage (z-index 12000) with chrome placed around the edges and the 3D scene between. The masthead is top-left (32px in, 26px down). The provenance meter (190px) and tracker exit are top-right (28px in). Chapter copy is bottom-left, at most 440px wide and never taller than the space between masthead and rail, with an overflow fade when there is more below. The chapter rail runs full width along the bottom with a 64px minimum height. The inspector is right-side, 330px wide, from 96px down. 3D labels are placed per frame in one of 18 slots around their anchor, clear of all of that chrome and of each other. A label whose anchor falls under chrome is hidden, never overlapped.

**Phones (max-width 767px).** Edge inset drops to 16px, and the provenance meter and long status line are hidden in favour of short variants. The rail becomes a grid: the forward CTA takes its own full-width opaque row, with the previous arrow and a horizontally scrolling chapter list beneath. Copy spans the width, capped at 50% height, over a black gradient. The light-path stop list collapses to a tick bar, and the inspector becomes a bottom sheet above the rail. On short screens (max-height 940px) and on phones, the event timeline shows only the current step's words.

**Console.** Draggable windows float over a full-bleed globe. A floating blurred dock sits on desktop, and a floating mobile nav on phones reserves `--mobile-nav-footprint` (66px). `pointer: coarse` media queries enlarge touch targets.

**Rhythm.** The explorer mostly uses gaps of 4, 8, 12 and 18px, with 32px (16px on phones) to the viewport edge.

## Elevation & Depth

The interface is flat. Depth comes from the 3D stage behind it, and the chrome separates from the stage with hairlines, scrims and gradients rather than shadows. The sky is vignetted by three linear gradients (left, bottom and top). The rail sits on a black gradient (0.86 to 0.5). Label chips and captions sit on a 62% black scrim. The inspector is the only glass surface in the explorer (72% near-black with a 12px blur). The console's dock and mobile nav use a stronger glass (blur 16px, saturate 1.5) with a solid fallback where backdrop-filter is unsupported.

### Shadow Vocabulary
- **Live glow** (`box-shadow: 0 0 10px var(--live)`): the breathing mission-status dot.
- **Footprint glow** (`filter: drop-shadow(0 0 4px rgba(68, 255, 68, 0.55))`): the detector outlines over the star field.
- **CTA hover glow** (`box-shadow: 0 6px 24px -8px var(--live)`): the forward CTA on hover only.
- **Floating chrome** (`box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45)`): the console dock and mobile nav.
- **Tooltip** (`box-shadow: 0 4px 12px rgba(0,0,0,0.5)`): console info tips.

### Named Rules
**The Glow Is Green Rule.** The only coloured shadows are soft glows of the live colour on live elements. Nothing uses a hard or offset shadow.

## Shapes

The explorer is square. Buttons, chips, captions, panels and the CTA all have 0 radius, and the only round shapes are the 5px label pins and the 6px status dot. Borders are 1px hairlines. Tracks and leader lines are 1px, and the ladder's reading mark is a 2 × 9px green tick. Detector outlines are 1.25px non-scaling strokes. Hubble's footprint is a 1px ink stroke dashed 3/2.

The console is mostly square as well, with 2 to 3px chips and 1px outlines, but its floating chrome is rounded: dock buttons and pills at 9px and the dock bar at 14px. Icons in both registers are single-stroke SVGs on a 16px viewBox. The console uses a 1.5 stroke with round caps in most icons. The explorer uses 1.4 with square caps at 14px.

## Components

### Buttons
Outlined and quiet, with one filled forward action per view.
- **Shape:** square corners (0).
- **Forward CTA:** live green fill, black text, 600 weight at 13px, 0.01em tracking, 11px 16px 11px 18px padding, trailing arrow. It always sits at the head of the chapter rail and labels the next chapter by name ("Pull back"). On hover a soft green glow appears below and the arrow slides 3px right (0.25s, arrive easing). On phones it spans the full width with the arrow pushed to the end.
- **Ghost:** transparent, 1px hairline border, ink text at 12px, 7px 12px padding. On hover the border turns full ink (0.2s). When disabled, the text drops to ink-3. Used for "Trace it again", "Replay from launch", "Frame", "Isolate", "All parts".
- **Exit:** the ghost treatment at 9px 14px padding with a trailing arrow, top-right, reading "Enter the tracker" ("tracker" on phones). Hidden on the final chapter, where the CTA takes over the exit.
- **Rail arrow:** a 36px square (32px on phones) with a hairline border, and 0.3 opacity when disabled.
- **Console Button** (`src/ui/shared/Button.svelte`): transparent with a 1px `--border`, in xs/sm/md/lg sizes from 9 to 13px. Hover lifts the border to `--border-hover`, and the active state turns accent blue. The ghost variant is borderless ghost-grey text. The danger variant hovers to `--danger`.

### Chips
- **Provenance tag:** text only, with no fill or border. PUB is live green, DER is ink-2, EST is estimate amber. It has a help cursor and a full-meaning `title`.
- **Provenance meter:** a 3px, three-segment bar with 2px gaps, segment widths proportional to PUB / DER / EST counts, and an 11px ink-3 caption.

### Cards / Containers
- **Inspector panel:** glass panel with a 1px hairline border, 16px 18px 14px padding, and a 12px backdrop blur. It holds the title with a close icon, a 12.5px ink-2 blurb, the fact table, an optional conflict note, and Frame / Isolate ghost buttons. It enters with the arrive keyframe (0.5s).
- **Fact table:** 12px text. Row labels are left, 400, ink-3. Values are right-aligned tabular figures, followed by a 34px column for the tag. Rows are divided by a 6% ink rule.
- **Conflict note:** 12px ink-2 on a 7% amber wash, 8px 10px padding, led by "Unresolved." in 600 amber.
- **Console window:** `--modal-bg` with a 1px `--border`. The titlebar is 4px 8px on `--ui-bg` with a bottom border, and holds the uppercase 11px ghost title and 10px icon controls.

### Inputs / Fields
- **Explorer controls:** native range and checkbox inputs, with `accent-color` set to the live green. The slider is 130px wide next to a 12px label.
- **Focus:** a 1px live-green outline at 3px offset on every focusable element in the explorer.

### Navigation
- **Chapter rail:** a full-width bottom bar with a hairline top border on a black gradient. It holds the previous arrow, a centred ordered list of chapter names (12.5px ink-3, ink on hover or when current), and the CTA at its head. The current chapter carries a 1px live-green underline that grows from the left (scaleX, 0.5s arrive easing) and `aria-current="step"`. Arrow keys and PageUp/PageDown step through chapters.
- **Parts index:** two columns inside the chapter panel, below a hairline. Group headings are 11px/500 ink-3. Rows are 12.5px ink-2 with a transparent 1px left border. The selected row turns live green on both text and left border.
- **Console dock:** a floating, blurred, 14px-radius bar of 27px icon buttons at 9px radius. Hover adds an 8% text wash. The active button is seated in a 15% accent pill.

### 3D-Anchored Label (signature)
A 5px round pin on the part, a 1px leader at 50% opacity running to the nearest edge of the chip, and an 11px chip on the caption scrim with a hairline border. Inactive chips are ink-3 and lit chips are ink. Placement runs every frame across 18 candidate slots: right of the part first, then left, then alternating rows above and below. A label keeps its last clear slot so it does not jump around, and it is hidden rather than drawn under chrome or another label. The hover readout uses the same chip with a live-green border and an 80% scrim.

### Figure Forms
Each chapter's numbers take the form their point needs.
- **Hero:** one number at figure size with an optional superscript, followed by a 12px ink-2 label and its tag.
- **Ladder:** a shared temperature scale from 20 °C to −190 °C. Each row has a label, a 1px hairline track filled with an ink gradient to the value, a 2 × 9px live-green tick at the reading, a right-aligned tabular value, and a tag, with 10px ink-3 axis labels above.
- **Ledger:** in/out rows split by hairlines, with the 11px ink-3 direction word in a 3.2em column and the value at 20px/500 tabular, then label and tag.

### In-Figure Caption
An 11px ink-2 caption on the caption scrim, 3px 7px padding, positioned by measuring against the figure. A figure legend adds a 1px live-green rule on its left edge. Its first line is ink and its "synthetic" disclaimer line is ink-2. Captions arrive 0.6s after the figure.

### Motion
- **Easing:** `cubic-bezier(0.22, 1, 0.36, 1)` for every explorer entrance, fade and underline.
- **Arrive:** from opacity 0, translateY(14px) and blur(4px). 0.9s for chapter copy and captions, 0.5s for the inspector and parts index. It re-runs on each chapter change.
- **Trace:** detector outlines fade in 1.4s each, staggered 40ms after a 120ms lead.
- **Breathe:** the status dot pulses to 0.35 opacity over 2.6s, and the loading square over 1.2s.
- **Reduced motion:** `prefers-reduced-motion: reduce` removes the arrive, trace and breathe animations and the sky, underline and arrow transitions. In script, camera flights run at zero duration, autorotation is off, and deploy and light-path timings collapse. The console's dock also drops its transitions.

## Do's and Don'ts

### Do:
- **Do** keep the ground pure black (#000) and set everything in Overpass Mono.
- **Do** use the theme's `--live` for anything active, measured, selected or published, and for nothing else.
- **Do** tag every hardware figure PUB, DER or EST inline, in the tag colours, with its meaning in `title`.
- **Do** draw structure with 1px hairlines (`hairline` in the explorer, `--border` in the console) and back floating text with the 62% caption scrim.
- **Do** give each explorer view exactly one filled live-green action, placed at the head of the chapter rail. Everything else is a ghost.
- **Do** place 3D labels clear of every piece of chrome and hide them when there is no clear slot.
- **Do** render hardware in its flight materials: silver-grey crinkled MLI, near-black cells on red-orange substrate, bare mirror coat.
- **Do** use `cubic-bezier(0.22, 1, 0.36, 1)` for entrances and honour `prefers-reduced-motion` in both CSS and camera script.
- **Do** keep icons as single-stroke 16px-viewBox SVGs in `currentColor`.

### Don't:
- **Don't** add a second typeface, or a system sans for display text.
- **Don't** use green, amber or accent blue decoratively. Each carries a meaning.
- **Don't** tint the observatory model with UI colours, and don't render its blankets gold. The flight hardware is silver.
- **Don't** nest content in filled cards. Windows, the inspector and the dock are the only containers. Don't use hard or offset shadows, or small uppercase labels above headings.
- **Don't** push provenance into footnotes or tooltips alone. The tag sits in the line.
- **Don't** use text glyphs rendered in a sans-serif as icons.
