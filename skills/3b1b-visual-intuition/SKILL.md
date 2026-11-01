---
name: 3b1b-visual-intuition
description: "Optional: Design mathematical lessons around visual discovery, continuous transformations, and prediction. Use when a learner needs intuition before formulas or when planning a 3Blue1Brown-style psi visual."
---

# Build visual intuition

Make the learner feel: "you could have invented this."
Start with a need that makes the new idea useful.
Choose a picture whose behavior carries the mathematical argument.
End with the formula that compresses what the learner already sees.

## Establish the learning target

Read the topic graph and the learner's demonstrated prerequisites.
Select one concept rather than trying to animate a whole textbook chapter.
Write an observable objective: "predict the sign of a dot product."
Name the prior idea the learner will reuse, such as signed distance.
Name the misconception the picture should make impossible to maintain.
Keep this objective beside the visual plan while choosing motions.

## Begin with a concrete puzzle

Give the learner two arrows and ask how much one points along the other.
Do not begin by defining a dot product as a sum of coordinate products.
Let the puzzle create demand for a measure of alignment.
Use a tiny numerical case the learner can inspect without calculation.
Ask for a prediction before revealing motion or an answer.
Accept a rough directional answer before requesting a number.

Useful puzzle shapes:

- What quantity stays unchanged as this picture moves?
- How could we measure this effect using only things we already know?
- Which arrangement makes the output zero?
- Can a familiar rule survive this unusual boundary case?

## Derive from the need

Try the simplest candidate measure first.
Show why arrow length alone cannot distinguish parallel from perpendicular.
Introduce a shadow on a reference direction as the missing ingredient.
Rotate the arrow continuously so the shadow changes sign visibly.
Only then name the projection and the dot product.
Explain which prior ideas were enough to invent the construction.
Separate the visual discovery from any later proof of uniqueness.

## Make visuals that are the math

Every moving object should correspond to a quantity or relationship.
A projection line encodes perpendicularity; a random sparkle encodes nothing.
Show signed projection with direction, labels, and color together.
Use a right-angle marker when perpendicularity matters to the inference.
Keep lengths proportional within the stated coordinate system.
Label a schematic diagram when exact scale is deliberately sacrificed.
Remove any motion that competes with the mathematical change.

## Preserve continuity

Morph a vector into its new position instead of replacing the whole scene.
Keep the plane, reference arrow, and origin visible during rotation.
Move the learner's attention with the object being transformed.
Use a cut only when changing the question or introducing a new setting.
Pause before and after a transformation so the endpoints can be compared.
Do not claim the Storyboard Anim contract includes a morph animation.
For exact interpolation of mathematical geometry, write a Manim scene when `psi_manim` is in your tool list
(it exists only with `PSI_CODE_EXEC=1`); otherwise use a slider explorable or describe the motion in words.
For Storyboards, use documented slide, grow, draw, or camera transitions.

## Use color as meaning

Assign BLUE to the main object and keep that assignment throughout.
Use YELLOW for the unknown or quantity being solved for.
Reserve RED for a constraint, counterexample, or error.
Use GREEN for the established result.
State the mapping in the plan before writing rendering code.
Never recolor the same vector just because it moved to another scene.
Add labels or line styles so meaning does not depend on color vision.
When introducing a new object, give it a name before adding another color.

## Pace prediction and discovery

Use a beat sequence: question, stillness, transformation, stillness, interpretation.
Leave about two seconds of genuine prediction time for a simple visual choice.
Use longer pauses when the learner must compare several cases.
Keep narration silent while the viewer is meant to think independently.
Do not narrate the answer during the prediction pause.
For a live tutoring turn, wait for the learner's response before revealing.
For video, clearly cue the pause and resume with a visible comparison.

## Put the formula last

First show parallel, perpendicular, and opposite arrows.
Ask what rule could account for the observed positive, zero, and negative outputs.
Summarize with the length-times-projection interpretation.
Then display the geometric formula and explain each factor by pointing to it.
Derive the coordinate formula afterward, if the learning objective needs it.
Keep both formulas anchored to the same objects and color assignments.
Do not let an impressive equation replace the explanatory picture.

## Essence, then rigor

State the intuitive claim in ordinary words first.
Specify assumptions before converting that claim into a theorem.
For projection, distinguish a unit direction from an arbitrary reference vector.
Explain why a negative projection is meaningful rather than an error.
Check the zero-vector case separately when discussing angles.
Follow the visual argument with an algebraic justification where needed.
Name the limits of the analogy instead of quietly extending it too far.

## Choose the psi deliverable

Choose a Manim scene for a derivation with dependent geometric motion, but only when `psi_manim` is available.
`psi_manim` is registered only when the host runs with `PSI_CODE_EXEC=1` (the Docker services set it).
Without it, use an explorable for the same relationship, or describe the motion step by step in words.
Examples include rotating vectors, transforming grids, and limiting secant slopes.
Use ValueTracker and always_redraw when geometry must stay linked numerically.
Consult the manim-scene-authoring skill before using psi_manim helpers.

Choose a Storyboard for a narrative with labels, characters, and mixed elements.
Use it when discrete scenes and simple entry/exit animations tell the argument.
Read storyboard-authoring for the exact 1600 by 900 element contract.
Do not add unsupported element kinds to simulate a richer animation engine.

Choose an ExplorableSpec when the learner should vary the parameters themselves.
Examples include testing matrix determinants or changing a growth rate.
Read explorable-explanations to choose one of the six supported templates.
Give each slider a prediction question rather than merely inviting random play.

Combine deliverables only when each has a distinct teaching job.
A short derivation can establish the picture; an explorable can test its range.
Avoid making three versions of the same explanation without a learning reason.

## A complete opening Storyboard

This is a narrative opening, not a substitute for continuous projection geometry.
Coordinates use the Storyboard canvas, with screen y increasing downward.
The blue arrow is the main object; the yellow arrow is the reference direction.

```json
{
	"id": "alignment-puzzle",
	"title": "How much does one arrow lean along another?",
	"topic": "linear-algebra",
	"conceptId": "dot-product",
	"style": "3b1b",
	"scenes": [
		{
			"id": "ask",
			"narration": "Which part of the blue arrow points along the yellow direction? Predict before we draw its shadow.",
			"durationSec": 10,
			"background": "#101426",
			"elements": [
				{
					"id": "main-vector",
					"kind": "vector",
					"props": { "x": 500, "y": 620, "dx": 360, "dy": -240, "stroke": "#58c4dd", "label": "v" },
					"enter": { "type": "draw", "duration": 1 }
				},
				{
					"id": "reference-vector",
					"kind": "vector",
					"props": { "x": 500, "y": 620, "dx": 450, "dy": 0, "stroke": "#ffff00", "label": "direction" },
					"enter": { "type": "draw", "delay": 1, "duration": 1 }
				},
				{
					"id": "prediction-label",
					"kind": "text",
					"props": { "x": 800, "y": 120, "text": "Predict the shadow", "size": 48, "align": "middle", "fill": "#ffffff" },
					"enter": { "type": "fade", "duration": 0.6 }
				}
			]
		}
	]
}
```

After this opening, animate the perpendicular foot with Manim if precision matters and `psi_manim` is available;
otherwise let the learner drag the angle in an explorable, or describe where the foot moves.
Before revealing it, ask whether increasing the arrow's angle lengthens its shadow.
After revealing it, test an obtuse angle and a perpendicular arrow.
End by asking the learner to invent a rule for the observed sign changes.

## Review the visual plan

- [ ] The opening puzzle can be attempted using existing prerequisites.
- [ ] A need motivates the new definition before its name appears.
- [ ] Each geometric object has an explicit mathematical meaning.
- [ ] The same object keeps its identity and color across transformations.
- [ ] A prediction pause occurs before the decisive reveal.
- [ ] The visual distinguishes positive, zero, negative, and limiting cases.
- [ ] The formula summarizes an already visible relationship.
- [ ] Assumptions and exceptions are stated after the core insight lands.
- [ ] The chosen renderer supports the planned motion without invented fields.
- [ ] A final transfer question changes the numbers or context.

## Handoff and completion

Deliver the puzzle, color key, beat order, and one learner check with the visual.
Include a brief note on the mathematical assumptions the picture uses.
Call `psi_storyboard` with `{ "storyboard": <complete Storyboard> }` when choosing that format.
Call `psi_explorable` with `{ "spec": <complete ExplorableSpec> }` when the learner should experiment.
For Manim (only with `psi_manim` available), inspect helpers, draft at low quality, and inspect the frames.
If a tool is unavailable, say so plainly: describe the visual in words or switch to `psi_explorable` /
`psi_storyboard`, and never claim a render happened. You may give the source for the learner to render.
Call the lesson effective only after the learner can explain or predict a new case.
