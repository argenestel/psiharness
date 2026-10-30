---
name: storyboard-authoring
description: Write and review exact psi Storyboard JSON with timed scenes, supported elements, and animations. Use when turning a lesson or narrative visual plan into an HTML-renderable storyboard.
---

# Author a psi Storyboard

Read core/src/types.ts before authoring against a changed checkout.
Treat its Storyboard, StoryScene, StoryElement, and Anim types as the contract.
Use visual/src/storyboard-html.ts for renderer behavior; do not invent fields to fill gaps.
Produce a complete JSON object rather than fragments with comments or ellipses.

## Top-level contract

Required fields are id, title, topic, style, and scenes.
id is an artifact identifier; use a descriptive kebab-case slug.
title is a human-readable string; topic is the topic's storage slug.
style is exactly "3b1b", "kurzgesagt", or "plain".
conceptId is an optional concept identifier from the topic graph.
palette is an optional name exported by visual/src/palettes.ts.
Omit palette to use the style default when the palette registry is unavailable.
Do not assume a palette name from an unrelated renderer is supported.
scenes is an array of StoryScene objects in presentation order.
Author at least one meaningful scene even though the interface alone permits an empty array.

## Scene contract

Each scene requires id, narration, durationSec, and elements.
Use unique scene ids within the storyboard.
narration must be a string, including when deliberately empty for a silent pause.
durationSec is a positive number in seconds; usually choose 5 to 12 seconds.
elements is an array of StoryElement objects.
background is optional: a CSS color or a palette token such as "bg" or "deep".
camera is optional and contains only optional numeric zoom, x, and y fields.
The camera describes the scene's END pose, interpolated from the previous scene.
Use a positive zoom and include x and y when framing a zoom deliberately.
Check the renderer's camera transform convention before promising exact framing.
An empty elements array may be intentional silence, but usually indicates missing content.

## Element and animation contract

Each element requires a string id, a supported kind, and a props object.
Optional enter, exit, and loop fields each contain one Anim object.
Keep element ids unique across the storyboard, including nested group descendants.
Use scene-prefixed ids with a stable semantic suffix to recognize recurring objects.
Preserving visual identity does not promise automatic geometry morphing.
The renderer ignores unknown props; misspellings may silently remove visible behavior.

An Anim requires type and optionally accepts delay, duration, and from.
Valid types are fade, pop, slide, draw, pulse, orbit, float, grow, and typewriter.
delay and duration are seconds; default delay is 0 and duration is 0.6.
Use nonnegative delays and positive durations in authored examples.
For enter, delay counts forward from scene start.
For exit, delay counts backward from scene end.
from is for slide and is "left", "right", "top", or "bottom".
Use enter for a reveal, exit for a departure, and loop for sustained background motion.
Do not use unsupported types such as morph, bounce, zoom, or rotate.
Use camera.zoom for camera scaling rather than an invented animation type.

## Every supported element kind

Question marks below mean optional properties, not literal JSON key characters.
Coordinates and sizes are in virtual canvas units unless the renderer states otherwise.

| Kind | Props from core/src/types.ts |
| --- | --- |
| circle | x, y, r, fill?, stroke? |
| rect | x, y, w, h, rx?, fill?, stroke? |
| text | x, y, text, size?, fill?, weight?, align?: "start" / "middle" / "end" |
| arrow | x1, y1, x2, y2, stroke?, width? |
| path | d, fill?, stroke?, width? |
| equation | x, y, tex, size?, fill? |
| graph | x, y, w, h, fn, domain: [a,b], range?: [c,d], stroke? |
| vector | x, y, dx, dy, stroke?, label? |
| creature | x, y, size?, color?, mood?: "happy" / "curious" / "surprised" |
| particles | x, y, w, h, count, color?, speed? |
| group | children: StoryElement[], x?, y?, scale?, rotate? |

For path, d is an SVG path-data string, not an array of coordinate pairs.
For graph, fn is a JavaScript expression in x, such as "Math.sin(x)".
Choose finite increasing domain and range bounds.
Do not use Python syntax such as "x**2 if x > 0 else 0" in graph.fn.
For equation, tex is LaTeX source; escape backslashes in JSON strings.
HTML may use KaTeX; preserve an intelligible text fallback when rendering offline.
For vector, dx and dy are endpoint offsets, not absolute endpoint coordinates.
For creature, use color rather than fill, and one of the three documented moods.
For group, children are full elements, with coordinates relative to the group.
Apply parent translation, scale, and rotation once; avoid double-offsetting children.
Group rotate is in degrees. HTML camera x/y are absolute canvas centers, defaulting to (800, 450).

## Lay out the 1600 by 900 canvas

The origin is top-left; x grows right and y grows downward.
Keep meaningful content inside an 80-unit inset from all four edges.
Reserve y=60 to 160 for titles; put title baselines at y=100 or lower.
Reserve y=800 to 860 for captions; prefer y=800 to 820 inside the safe inset.
Check glyph bounds, not only anchor coordinates, at the bottom and right edges.
Use x=200, 800, and 1400 as a three-column planning grid.
Narrow the outer columns for long text to preserve the safe area.
Use the central region y=200 to 740 for the main diagram.
Keep labels close to the objects they identify without intersecting strokes.
Use align="middle" for centered labels and align="start" for short paragraphs.
Split long text into multiple text elements with deliberate line spacing.
Use plain, short labels rather than shrinking important text until it is unreadable.
Test a small preview because the logical canvas will often be scaled down.

## Time the scene

For each entering element, compute finish = delay + duration, including defaults.
Require durationSec >= the maximum finish among all elements, including children.
The last-finishing element's delay and duration must both fit in the scene.
For a group reveal plus child reveals, inspect whether the renderer composes delays.
Leave viewing time after the final reveal rather than ending on its last frame.
Keep narration at or below durationSec * 2.5 words, roughly 150 words per minute.
Budget extra time for unfamiliar notation and numbers even below that upper bound.
Use 5 to 12 seconds per ordinary scene, one explanatory idea per scene.
Plan exit duration plus its end-relative delay to fit inside the scene as well.
Do not let exit timing erase a label before its narration has finished.
Reserve silent time for predictions rather than filling every second with speech.

## Minimal complete Storyboard

```json
{
	"id": "one-question",
	"title": "What changes?",
	"topic": "functions",
	"style": "plain",
	"scenes": [
		{
			"id": "question",
			"narration": "What changes when we double the input? Make a prediction.",
			"durationSec": 6,
			"elements": [
				{
					"id": "question-text",
					"kind": "text",
					"props": { "x": 800, "y": 420, "text": "Double the input. What happens?", "size": 48, "align": "middle" },
					"enter": { "type": "fade", "duration": 0.6 }
				}
			]
		}
	]
}
```

## Three-scene construction

The group contains local coordinates, then an arrow connects quantities.
The graph closes the argument with the same blue input-to-output relationship.
Scene-level repetition keeps these examples short without inventing shared objects.

```json
{
	"id": "doubling-machine",
	"title": "A doubling machine",
	"topic": "functions",
	"style": "3b1b",
	"scenes": [
		{
			"id": "input",
			"narration": "Place one input into a machine that doubles it.",
			"durationSec": 6,
			"elements": [
				{
					"id": "machine",
					"kind": "group",
					"props": {
						"x": 650, "y": 300,
						"children": [
							{ "id": "machine-box", "kind": "rect", "props": { "x": 0, "y": 0, "w": 300, "h": 200, "rx": 20, "fill": "#17445c" } },
							{ "id": "machine-label", "kind": "text", "props": { "x": 150, "y": 115, "text": "Double", "size": 42, "align": "middle", "fill": "#ffffff" } }
						]
					},
					"enter": { "type": "pop", "duration": 0.6 }
				}
			]
		},
		{
			"id": "output",
			"narration": "Two becomes four. Predict the output for three.",
			"durationSec": 6,
			"elements": [
				{ "id": "input-value", "kind": "text", "props": { "x": 350, "y": 450, "text": "2", "size": 72, "fill": "#58c4dd" } },
				{ "id": "mapping", "kind": "arrow", "props": { "x1": 500, "y1": 420, "x2": 1050, "y2": 420, "stroke": "#58c4dd", "width": 6 }, "enter": { "type": "draw", "delay": 1, "duration": 1 } },
				{ "id": "output-value", "kind": "text", "props": { "x": 1200, "y": 450, "text": "4", "size": 72, "fill": "#83c167" }, "enter": { "type": "fade", "delay": 2, "duration": 0.6 } }
			]
		},
		{
			"id": "relationship",
			"narration": "The whole line records the rule. Each output is twice its input.",
			"durationSec": 7,
			"elements": [
				{ "id": "doubling-graph", "kind": "graph", "props": { "x": 300, "y": 210, "w": 1000, "h": 500, "fn": "2*x", "domain": [-2, 2], "range": [-4, 4], "stroke": "#58c4dd" }, "enter": { "type": "draw", "duration": 1.5 } },
				{ "id": "rule", "kind": "equation", "props": { "x": 800, "y": 800, "tex": "y=2x", "size": 40, "fill": "#83c167" }, "enter": { "type": "fade", "delay": 3, "duration": 0.6 } }
			]
		}
	]
}
```

## Common validation errors and fixes

Duplicate element ids: rename colliding elements anywhere in the storyboard, including descendants.
Missing props for a kind: compare against the table; an empty props object is not a drawable circle.
Unknown Anim type: replace it with a supported type or use Manim for continuous geometry.
Group children misplaced: remove repeated parent offsets from their local coordinates.
Text overflow: shorten labels, split lines, and inspect the actual preview bounds.
Unknown palette: choose an exported registry name or omit palette for the style default.
Empty scenes: add the missing explanatory element or deliberately document a silent beat.
Non-string narration: replace arrays, null, or numbers with an actual string.
Invalid JSON: remove comments and trailing commas, then parse the complete object.
Truncated animation: extend durationSec or reduce delays while preserving viewing time.
Unreadable graph: set domain and range deliberately and test finite expression outputs.
Camera drift: specify the intended later end pose rather than assuming an automatic reset.

## Saving and rendering

Parse the JSON and check the contract before sending it to a tool.
Call `psi_storyboard` with `{ "storyboard": <complete Storyboard> }`.
The tool saves to $PSI_HOME/topics/<topic>/storyboards/<id>.json and renders HTML.
The tool returns `{ path }` on success or `{ errors }` on validation failure; confirm the result before reporting a save.
If unavailable, return the complete JSON and clearly say it has not been saved or rendered.
After rendering, inspect layout, timing, camera framing, and the final output path.
Keep narration comprehensible when optional speech or online equation rendering is unavailable.
