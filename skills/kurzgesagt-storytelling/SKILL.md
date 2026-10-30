---
name: kurzgesagt-storytelling
description: "Optional: Craft warm science narratives with surprising hooks, concrete scale comparisons, and flat vector Storyboards. Use when a psi lesson needs a Kurzgesagt-style explainer with narration, camera beats, and a viewer creature."
---

# Tell a story across scales

Make an unfamiliar idea feel both immense and approachable.
Use a strange question, a sequence of scale changes, and a small viewer stand-in.
End with a useful perspective rather than a pile of disconnected facts.
Keep factual uncertainty visible, especially when comparing biological sizes.

## Start with the learner's question

Write one sentence stating what the viewer should understand afterward.
For a cell lesson: "a cell is small compared with us, yet large compared with its parts."
Choose the minimum prerequisite needed to make that contrast meaningful.
Do not try to teach every organelle while teaching relative size.
Use one central question as the spine of the explainer.
Let each scene answer part of it or make the next question necessary.

## Hook within five seconds

Start with a strange fact or an answerable question in the first five seconds.
For example: "How can something invisible hold a whole working world?"
Show the object immediately instead of introducing the channel or the topic title first.
Keep the opening sentence short enough to finish inside the hook window.
At 150 words per minute, five seconds holds about twelve words.
Make the first visual legible before adding its explanatory labels.
Avoid false claims of impossibility merely to make the hook surprising.

## Build a causal narrative

Use hook, question, build, reveal, zoom-out, and recap as planning beats.
These beat names describe the script; they are not StoryScene fields.
Turn each beat into a scene with id, narration, durationSec, and elements.
Each scene should introduce one idea the next scene depends on.
Use a reveal to resolve a question the learner has actually been asked.
Keep transitions motivated: "to understand its size, shrink our ruler."
Delete interesting facts that do not serve the main question.

## Make scale jumps countable

Move between levels by explicit factors of 10 to 1000.
Write both the old and new reference lengths before calculating the ratio.
Use compatible units, such as 1 m = 1000 mm and 1 mm = 1000 micrometers.
A 1 mm reference is 100 times a representative 10 micrometer cell width.
A 10 micrometer cell is 10 times a representative 1 micrometer feature.
Say "representative" or "for this example" when nature has a wide size range.
Do not imply all cells have the same diameter or all organelles have one size.
Specify length ratios; area and volume scale by different powers.
Keep the current scale label visible until the next scale is established.

## Use comparisons the viewer can picture

Translate a difficult measurement into a familiar length comparison.
If a 10 micrometer cell becomes 10 meters wide, the enlargement is one million times.
A 1 micrometer feature then becomes 1 meter wide in the same model.
Call 10 meters roughly bus-length; actual buses vary.
Do not compare a diameter to a volume or silently switch reference scales.
Use two significant figures at most when the biological value is approximate.
Place "illustrative scale" or "not to scale" on diagrams that distort geometry.
Prefer one memorable comparison over three unrelated household objects.

## Keep a viewer stand-in

Use a creature element as the viewer's curious companion.
Its documented props are x, y, size, color, and mood.
The only supported moods are happy, curious, and surprised.
Let the creature point attention through position and expression.
Use curious before a question, surprised at a reveal, and happy at a recap.
Do not make the creature's emotions substitute for an explanation.
Keep its size and color stable unless a scale change is explicitly part of the joke.
Avoid unsupported props such as eyes, mouth, pose, or speechBubble.
Create speech as a separate text element when needed.

## Write warm humor

Aim jokes at our expectations or our awkward measuring tools.
Give the creature an absurdly oversized ruler, then explain why it fails.
Let humor release tension after a difficult number or a dizzying zoom.
Keep the explanatory sentence understandable if the viewer misses the joke.
Do not ridicule the learner or turn disease and suffering into casual punchlines.
Use one small comic beat instead of running a separate comedy narrative.

## Use optimistic nihilism carefully

The universe does not care about our scale, and that can be wonderful.
Turn smallness into permission to be curious, not a claim that nothing matters.
Pair cosmic distance with a concrete local action: look closer, ask, test, learn.
Use the tone only where it serves the topic and the learner.
Do not smuggle philosophical assertions into the scientific evidence.
For the cell story, end with appreciation for nested organization rather than destiny.

## Compose a flat vector world

Use saturated accents on a dark-ish background with readable foreground text.
Prefer circles, rounded rectangles, simple paths, and bold silhouettes.
Use a limited palette with one persistent color for each recurring object.
Build depth with broad background shapes, a middle object, and foreground labels.
Suggest soft glow with restrained layered shapes or supported renderer styling.
The contract has no glow prop; do not invent one.
Keep secondary particles sparse enough that the main comparison remains obvious.
Do not add photographic textures to compensate for a weak silhouette.

## Layer motion and parallax

Reveal the background first, then the main subject, then its explanatory label.
Use float or a subtle slide for a foreground companion when appropriate.
Plan parallax as differential layer motion, not a supported "parallax" Anim type.
Use Manim or renderer-supported composition if true independent layer motion is necessary.
Avoid moving labels while asking the viewer to read a difficult number.
Depth should organize attention, not imply false physical distances.

## Map the script to StoryScene

Put spoken text in narration as a string.
Set durationSec to 5 through 12 seconds for ordinary scenes.
Budget about 150 words per minute, or 2.5 words per second at most.
Use shorter narration when the scene includes a new unit or calculation.
Give each element a unique id across the storyboard, including nested children.
Use only kinds and props from core/src/types.ts.
Choose enter/exit/loop types only from the documented Anim union.
Check the latest enter delay plus duration against durationSec.
Reserve a pause before revealing the result of a comparison.

## Camera and physical scale

Use camera.zoom, camera.x, and camera.y on scenes that change framing.
Camera is the end-of-scene pose; renderers interpolate from the previous pose.
In HTML, x and y are absolute canvas centers, defaulting to (800, 450).
Always inspect the resulting frame before promising a particular crop.
Physical scale labels carry the numerical argument.
Camera zoom is a composition control and need not equal the physical scale factor.
For huge jumps, rebase the diagram and display the old/new reference explicitly.
Do not claim a 1.2 camera zoom itself depicts a 1000-fold physical enlargement.
Reset or reframe the camera deliberately for the recap rather than assuming it resets.

## Complete cell example

Read [the complete Storyboard](references/how-big-is-a-cell.storyboard.json) before adapting it.
It contains eight scenes and is a standalone Storyboard JSON object.
The artifact id is how-big-is-a-cell, the topic is cell-biology, and style is kurzgesagt.
The route is a meter reference, a millimeter, a 10 micrometer cell, and a 1 micrometer feature.
The labeled jumps are 1000 times, 100 times, and 10 times in length.
The example then enlarges the cell to bus-length to make its internal scale tangible.
The creature reacts before a final zoom-out and a retrieval question.
The cell and feature sizes are representative examples, not universal measurements.
The camera changes are gentle framing moves between rebased scale diagrams.
The example omits palette to use the kurzgesagt style default.

## A small complete opening

Use this shorter object when only the opening beat is needed.
Expand it into a sequence before presenting it as a finished explainer.

```json
{
	"id": "invisible-world-hook",
	"title": "A world too small to see",
	"topic": "cell-biology",
	"style": "kurzgesagt",
	"scenes": [
		{
			"id": "hook",
			"narration": "How can something invisible hold a whole working world?",
			"durationSec": 5,
			"background": "#18243c",
			"elements": [
				{ "id": "cell", "kind": "circle", "props": { "x": 800, "y": 430, "r": 180, "fill": "#19b9ad", "stroke": "#b8ffe9" }, "enter": { "type": "grow", "duration": 0.8 } },
				{ "id": "viewer", "kind": "creature", "props": { "x": 1200, "y": 650, "size": 90, "color": "#ffbb55", "mood": "curious" }, "enter": { "type": "pop", "delay": 0.8, "duration": 0.6 } }
			]
		}
	]
}
```

## Review before delivery

- [ ] The hook lands in the first five seconds without exaggerating the science.
- [ ] Each scene carries one idea and narration fits its duration.
- [ ] Every scale ratio has compatible units and a stated length interpretation.
- [ ] The bus comparison and the feature use the same enlargement factor.
- [ ] The creature uses only supported props and moods.
- [ ] Colors preserve object identity and text stays readable on dark backgrounds.
- [ ] Camera moves support the diagram without pretending to be the physical ratio.
- [ ] The recap returns to the question and invites one prediction or explanation.

## Save and inspect

Call `psi_storyboard` with `{ "storyboard": <complete Storyboard> }` when the tool is available.
Inspect the returned HTML for clipped labels, camera crops, and narration timing.
Return source with an explicit unrendered status if the tool is unavailable.
Do not claim a saved artifact exists merely because the example JSON is complete.
