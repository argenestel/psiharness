---
name: explorable-explanations
description: "Optional: Design slider-driven psi explorables that teach through prediction and parameter changes. Use when learners need to test a mathematical pattern themselves with one of the six ExplorableSpec templates."
---

# Let the learner change the explanation

Use interactivity when a parameter change is itself the argument.
Ask the learner to predict a visible consequence, change one control, then explain it.
Choose video when a one-way narrative, timed reveal, or guided emotional arc matters more.
Do not add sliders to a story whose meaning never changes with their values.

## Work from the contract

Read core/src/types.ts for the ExplorableSpec envelope.
Required fields are id, title, topic, style, template, params, sliders, and prompts.
conceptId is optional; use an existing graph concept when one is available.
style is "3b1b", "kurzgesagt", or "plain".
Every slider needs name, label, min, max, step, and value.
Keep finite numeric bounds, min < max, step > 0, and value inside the closed interval.
Use unique identifier-like names; avoid x, y, t, Math, and language keywords.
prompts is an array of strings, not an object mapping questions to answers.

The type's doc comment describes behaviors, not authoritative parameter spellings.
visual/src/explorable.ts is the authoritative source for template params and bindings.
The examples below use its supported parameter names and valid contract envelopes.
Match slider names exactly to the variables the template consumes.
Keep fixed configuration in params; slider initial values belong in sliders[].value.

## Design the experiment

Choose a visible dependent quantity and one primary independent parameter.
Write a question whose answer changes somewhere in the slider range.
Start at an informative default rather than an empty or numerically unstable state.
Show numerical readouts with units alongside the visual relationship.
Use a second slider only when comparing its effect has a clear learning purpose.
Offer a reset or state the default settings so observations can be reproduced.
Distinguish simulation randomness from a change in the underlying mathematical rule.
Keep the explanation understandable without audio or network access.

## function-plot

Shows how a function's graph responds to parameter changes.
Use params.fn for an expression in x and slider names; domain and optional range are numeric pairs.
Optional params.compare supplies a reference expression in the current renderer.
The example uses a and b as slope and intercept, not special built-in names.
Use JavaScript Math calls for functions and explicit multiplication.
Keep expressions pure mathematical formulas rather than programs or external data access.

```json
{
	"id": "slope-and-intercept",
	"title": "Tilt or lift a line",
	"topic": "functions",
	"style": "3b1b",
	"template": "function-plot",
	"params": { "fn": "a*x+b", "compare": "x", "domain": [-4, 4], "range": [-8, 8] },
	"sliders": [
		{ "name": "a", "label": "Slope a", "min": -2, "max": 2, "step": 0.1, "value": 1 },
		{ "name": "b", "label": "Intercept b", "min": -3, "max": 3, "step": 0.1, "value": 0 }
	],
	"prompts": [
		"Predict what remains fixed when only a changes and b is zero.",
		"Hold a fixed. Does changing b tilt the line or lift it?",
		"Set a to zero. Which input values now have the same output?",
		"Make the slope negative. What changes about left-to-right motion?"
	]
}
```

What to notice: separate a change in rate from a change in starting value.
The four prompts encode fixed-point, translation, constant-function, and sign checks.
If the plot clips at extreme settings, widen range or tell the learner why it clips.

## linear-transform

Shows a 2 by 2 matrix acting on a grid and selected vectors.
The matrix sliders are a, b, c, d, interpreted as rows [[a,b],[c,d]].
Current params include vectors (coordinate pairs), showDeterminant, and showEigen booleans.
Use the four sliders exactly; changing one entry changes one matrix component.
The first and second columns describe images of the two basis vectors.

```json
{
	"id": "shear-the-plane",
	"title": "A matrix moves the whole plane",
	"topic": "linear-algebra",
	"style": "3b1b",
	"template": "linear-transform",
	"params": { "vectors": [[1, 0], [0, 1], [1, 1]], "showDeterminant": true, "showEigen": true },
	"sliders": [
		{ "name": "a", "label": "a: first basis x", "min": -2, "max": 2, "step": 0.1, "value": 1 },
		{ "name": "b", "label": "b: second basis x", "min": -2, "max": 2, "step": 0.1, "value": 1 },
		{ "name": "c", "label": "c: first basis y", "min": -2, "max": 2, "step": 0.1, "value": 0 },
		{ "name": "d", "label": "d: second basis y", "min": -2, "max": 2, "step": 0.1, "value": 1 }
	],
	"prompts": [
		"Change b only. Which basis vector stays fixed?",
		"Reset a=d=1 and c=0. Does shear change the unit square's area?",
		"Set a=c=0. Predict the dimension of the image.",
		"Make the determinant negative. What happens to orientation?"
	]
}
```

What to notice: basis images explain the entire grid, not just the highlighted arrows.
Distinguish a collapsed plane from an ordinary compression and a reflection from rotation.
Do not promise real eigenvector directions for every matrix.

## vector-field

Shows a vector assigned to each point and particles advected by midpoint integration.
Current params.fx and params.fy are expressions in x, y, and slider names.
The example combines rotation with radial attraction or repulsion.
omega controls turning; k controls the outward radial contribution.
Do not confuse field arrows with particle paths: one gives local direction at a point.

```json
{
	"id": "swirl-and-source",
	"title": "Rotation or escape?",
	"topic": "vector-calculus",
	"style": "3b1b",
	"template": "vector-field",
	"params": { "fx": "-omega*y+k*x", "fy": "omega*x+k*y" },
	"sliders": [
		{ "name": "omega", "label": "Rotation strength", "min": -2, "max": 2, "step": 0.1, "value": 1 },
		{ "name": "k", "label": "Radial strength", "min": -1, "max": 1, "step": 0.1, "value": 0 }
	],
	"prompts": [
		"At k=0, predict the arrow direction on the positive x axis.",
		"Reverse omega. What reverses and what stays centered?",
		"Keep omega fixed and make k positive. Do arrows lean outward?",
		"Make k negative. Predict what a moving particle would approach."
	]
}
```

What to notice: the same local rule produces a globally organized pattern.
At the origin both components are zero for every setting in this example.
Keep claims about trajectory speed tied to the renderer's numerical integration choices.

## fourier-epicycles

Shows rotating vectors whose summed endpoint traces a path.
Current params.shape selects square, sawtooth, heart, or custom.
For custom, params.points is an array of at least three numeric [x,y] pairs.
The terms slider controls the retained count and speed controls playback.
Use integer term counts and keep speed separate from the approximation's geometry.
Check the renderer's available coefficient count before selecting a very large maximum.

```json
{
	"id": "circles-draw-a-square",
	"title": "A square made of rotations",
	"topic": "fourier-series",
	"style": "3b1b",
	"template": "fourier-epicycles",
	"params": { "shape": "square" },
	"sliders": [
		{ "name": "terms", "label": "Retained terms", "min": 1, "max": 25, "step": 1, "value": 5 },
		{ "name": "speed", "label": "Playback speed", "min": 0.1, "max": 2, "step": 0.1, "value": 0.5 }
	],
	"prompts": [
		"Predict the trace with just one rotating term.",
		"Increase terms. Which parts of the square are hardest to approximate?",
		"Change speed only. Does the intended curve change?",
		"Compare five and twenty-five terms near a corner. What improves?"
	]
}
```

What to notice: complexity appears through addition of simple periodic motions.
Do not imply a finite sum makes a mathematically perfect sharp corner.
Ask about what improves with terms, not whether the image looks impressive.

## probability-sim

Shows repeated random trials and an empirical histogram beside an expected pattern.
Current params.experiment is coin, dice, or galton.
Required sliders are trials and p; p controls bias for coin/galton, not fair dice.
In the current renderer, trials is a batch-size control, not a final cumulative sample count.
Read the displayed total when comparing convergence across runs.
Keep p between 0 and 1 and choose integer trial batches.

```json
{
	"id": "coin-convergence",
	"title": "Random outcomes, stable proportions",
	"topic": "probability",
	"style": "kurzgesagt",
	"template": "probability-sim",
	"params": { "experiment": "coin" },
	"sliders": [
		{ "name": "trials", "label": "Trials per batch", "min": 1, "max": 500, "step": 1, "value": 10 },
		{ "name": "p", "label": "Probability of heads", "min": 0, "max": 1, "step": 0.05, "value": 0.5 }
	],
	"prompts": [
		"With p=0.5, must the first ten outcomes contain exactly five heads?",
		"Increase the batch size. Does the observed fraction become more stable?",
		"Set p=0.8. Predict the long-run fraction before running.",
		"At p=0 or p=1, which randomness disappears?"
	]
}
```

What to notice: convergence is a tendency, not a guarantee for every finite sample.
Repeated runs at the same settings may differ; never grade one random realization as a law.
Changing any slider resets the sample history; Start, Pause, and Reset control the run.

## exponential-growth

Shows repeated proportional change, with optional doubling or capacity-limited models.
Current params.mode is compound, doubling, or logistic.
Required sliders are rate, steps, and capacity, even when capacity is inactive in compound mode.
For compound, the current model starts at one and uses (1+rate)^t.
For doubling, the current rate is doublings per step, giving 2^(rate*t).
For logistic, the capacity-limited curve is K/(1+(K-1)*Math.exp(-rate*t)), starting at one.
K is capacity; rate is the continuous growth rate per step. Linear and compound curves remain visible for comparison.
This example selects compound and labels capacity's inactive role explicitly.

```json
{
	"id": "compounding-vs-addition",
	"title": "The same percentage, a changing increment",
	"topic": "growth-models",
	"style": "kurzgesagt",
	"template": "exponential-growth",
	"params": { "mode": "compound" },
	"sliders": [
		{ "name": "rate", "label": "Fractional change per step", "min": -0.2, "max": 0.5, "step": 0.05, "value": 0.2 },
		{ "name": "steps", "label": "Number of steps", "min": 1, "max": 20, "step": 1, "value": 10 },
		{ "name": "capacity", "label": "Capacity (logistic mode only)", "min": 10, "max": 200, "step": 10, "value": 100 }
	],
	"prompts": [
		"At positive rate, do equal time steps add equal amounts?",
		"Predict the trajectory when the rate becomes zero.",
		"Make the rate negative. Does the quantity fall by equal amounts?",
		"Double the step count at rate 0.2. Does the final value merely double?"
	]
}
```

What to notice: multiplying by a fixed factor differs from adding a fixed increment.
Keep compound rates above -1 so this simple positive-population model remains meaningful.
Do not imply an unbounded model is a realistic forecast forever.

## Slider design checklist

- [ ] The range includes informative positive, zero, negative, or critical regimes where meaningful.
- [ ] Bounds avoid undefined expressions, misleading clipping, and runaway simulation costs.
- [ ] Step sizes expose the pattern; counts use integers and probabilities stay in [0,1].
- [ ] Defaults reveal something immediately and can be reproduced after exploration.
- [ ] Each control's label states its meaning and units, including inactive controls.
- [ ] Slider names match renderer bindings and expression identifiers exactly.
- [ ] Three to five prompts ask for predictions, comparisons, and explanations.
- [ ] The final question transfers the pattern to a setting the learner has not tried.

## Save and inspect

Parse the JSON, validate its envelope, and check params against visual/src/explorable.ts.
Call `psi_explorable` with `{ "spec": <complete ExplorableSpec> }`.
The tool returns `{ path }` on success or `{ errors }` on validation failure.
Inspect the returned interactive HTML at defaults, extremes, and a critical intermediate value.
If the tool is unavailable, deliver the complete spec and say it has not been saved or rendered.
Finish by asking the learner to explain the observed pattern in their own words.
