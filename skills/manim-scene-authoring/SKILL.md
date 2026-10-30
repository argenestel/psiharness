---
name: manim-scene-authoring
description: "Optional: Author mathematical Manim Community scenes using psi_manim helpers, trackers, and linked geometry. Use for continuous derivations, projections, limits, and transformations that need precise animated relationships."
---

# Write a mathematical scene

Target Manim Community v0.18+ rather than ManimGL.
Read python/psi_manim/*.py before using helpers: signatures may still be settling.
Check python/psi_manim/__init__.py for actual public exports.
Do not assume a proposed helper call is already implemented in this checkout.
Start with a puzzle, preserve object identity through motion, and show the formula last.

## Helper vocabulary and current calling conventions

PsiScene is the base Scene subclass with palette/colour conventions and a default dark background.
Use it instead of resetting colors and background independently in every scene.
title_card(text) places a readable title; currently call self.title_card(text).
caption(text) replaces the lower caption; currently call self.caption(text).
narrate(scene, text, duration) describes the desired narration operation.
In the current helper implementation, its equivalent is scene.narrate(text, run_time=duration).
It displays a caption and waits; it does not synthesize audio.
title_card, caption, and narrate are methods here, not guaranteed module-level exports.

transform_grid(scene, ...) describes applying a matrix to a grid in a scene.
Currently transform_grid(matrix) returns (grid, animation); add grid, then play animation yourself.
plot_with_tracker(...) builds a function plot with a tracked sample point.
Currently plot_with_tracker(fn, x_range=...) returns (group, tracker).
The group's members are axes, curve, and moving dot in that order.
epicycles(...) constructs linked rotating circles and their trace.
Currently epicycles(coeffs) returns (objects, time_tracker, trace); coefficients pair frequency and complex amplitude.
growth_dots(...) constructs a compact population of dots.
Currently growth_dots(n) returns a VGroup for a nonnegative integer n.
vector_on_plane(...) places a vector on a coordinate plane.
Currently vector_on_plane(vector=(2, 1), color=BLUE) returns VGroup(plane, arrow).
Recheck all return structures before unpacking them in another checkout.

## Color and geometry conventions

Use BLUE for the main object.
Use YELLOW for the thing being solved for or the quantity under examination.
Use RED for a constraint, failed case, or error.
Use GREEN for the established result.
Import these colors from psi_manim to share the local palette.
Keep each object the same color throughout the scene.
Use labels and line styles as additional signals; do not rely on color alone.
Manim coordinates have y increasing upward, unlike the Storyboard canvas.
Use plane.c2p or axes.c2p to convert mathematical coordinates into scene points.
Keep titles at the top and captions clear of the mathematical working area.

## Track parameters rather than independent objects

Keep one source of truth for each mathematical degree of freedom.
ValueTracker holds the parameter; always_redraw rebuilds dependent geometry.
Read tracker.get_value() inside the redraw function, not once outside it.
Add redraw objects to the scene before animating their tracker.
Avoid constructing MathTex inside a per-frame callback; LaTeX work is expensive.
Clear updaters when replacing dynamic objects with a fixed final result.
Here is a complete small pattern using only Manim's built-in objects.

```python
from manim import Scene, ValueTracker, Dot, always_redraw, RIGHT, linear


class TrackedDot(Scene):
	def construct(self):
		t = ValueTracker(-2)
		dot = always_redraw(lambda: Dot(t.get_value() * RIGHT))
		self.add(dot)
		self.wait(1)
		self.play(t.animate.set_value(2), run_time=3, rate_func=linear)
		dot.clear_updaters()
		self.wait(1)
```

## MathTex and formula continuity

Use raw Python strings, such as r"\frac{df}{dx}", to avoid accidental escape sequences.
Pass stable formula parts as separate MathTex arguments for TransformMatchingTex.
Keep the same TeX token spelling when a symbol should match across the rewrite.
Use substrings_to_isolate when set_color_by_tex must select a token inside a longer expression.
Check rendered grouping: matching TeX is based on parts, not mathematical equivalence.
Show the geometric relationship before displaying the compressed symbolic statement.
Keep algebraic steps valid for the chosen nonzero denominators and domain.
See the official [text and formulas guide](https://docs.manim.community/en/stable/guides/using_text.html)
and [TransformMatchingTex reference](https://docs.manim.community/en/stable/reference/manim.animation.transform_matching_parts.TransformMatchingTex.html).

## Complete example: dot product as projection

The reference vector is a unit direction mathematically, drawn longer for readability.
The blue vector has fixed length two; its signed horizontal projection is 2 cos(theta).
The dashed connector ties the endpoint to its perpendicular foot.
The yellow dot remains visible even when the projection is zero.
Pause before each angle change so the viewer can predict the sign.
Save this entire block as projection.py when rendering it.

```python
import math
from manim import (
	Arrow, DashedLine, Dot, Line, MathTex, ValueTracker,
	always_redraw, linear, DOWN,
)
from psi_manim import PsiScene, vector_on_plane, BLUE, YELLOW, GREEN


class DotProductProjection(PsiScene):
	def construct(self):
		self.title_card("How much points along the reference direction?")
		plane, reference = vector_on_plane((3, 0), color=YELLOW)
		theta = ValueTracker(math.pi / 6)
		def endpoint():
			angle = theta.get_value()
			return plane.c2p(2 * math.cos(angle), 2 * math.sin(angle))
		def foot():
			return plane.c2p(2 * math.cos(theta.get_value()), 0)
		main = always_redraw(lambda: Arrow(
			plane.c2p(0, 0), endpoint(), buff=0, color=BLUE,
		))
		connector = always_redraw(lambda: DashedLine(endpoint(), foot(), color=YELLOW))
		shadow = always_redraw(lambda: Line(plane.c2p(0, 0), foot(), color=YELLOW))
		marker = always_redraw(lambda: Dot(foot(), color=YELLOW))
		self.add(plane, reference, main)
		self.narrate("Predict where the blue arrow casts its shadow.", run_time=2)
		self.add(connector, shadow, marker)
		self.wait(2)
		self.caption("Predict the shadow at a right angle.")
		self.wait(2)
		self.play(theta.animate.set_value(math.pi / 2), run_time=3, rate_func=linear)
		self.narrate("Perpendicular means zero projection.", run_time=2)
		self.caption("What happens when the arrow points partly backward?")
		self.wait(2)
		self.play(theta.animate.set_value(5 * math.pi / 6), run_time=3, rate_func=linear)
		self.narrate("The projection is signed: it is now negative.", run_time=2)
		formula = MathTex(r"\mathbf{v}\cdot\hat{\mathbf{u}}", "=", r"2\cos\theta")
		formula.set_color(GREEN).scale(0.8).shift(1.7 * DOWN)
		self.add(formula)
		self.narrate("A dot product with a unit direction measures signed projection.", run_time=4)
		for mob in (main, connector, shadow, marker):
			mob.clear_updaters()
		self.wait(1)
```

The yellow reference arrow's drawn length does not multiply the projection.
Say explicitly that hat-u denotes its unit direction.
For a nonunit second vector, multiply the projection by that vector's length.
Do not extend the angle interpretation to a zero reference vector without a caveat.

## Complete example: secant approaching tangent

Use f(x)=x squared / 2 and a=0.5 so both moving samples remain in view.
The helper's tracker is the moving sample coordinate, not the gap h.
Keep it strictly above a during the secant animation to avoid division by zero.
The limiting tangent is then constructed analytically, not by dividing by zero.
Save this entire block as derivative.py when rendering it.

```python
from manim import (
	Dot, Line, MathTex, TransformMatchingTex, always_redraw,
	Create, FadeOut, DOWN, linear,
)
from psi_manim import PsiScene, plot_with_tracker, BLUE, YELLOW, GREEN


class SecantToTangent(PsiScene):
	def construct(self):
		self.title_card("Can an average slope become an instantaneous slope?")
		def f(x):
			return x * x / 2
		a = 0.5
		plot, sample = plot_with_tracker(f, x_range=(-2, 2, 1))
		axes, curve, moving_dot = plot
		curve.set_color(BLUE)
		sample.set_value(2)
		fixed = Dot(axes.c2p(a, f(a)), color=YELLOW)
		def secant_line():
			b = sample.get_value()
			slope = (f(b) - f(a)) / (b - a)
			return Line(
				axes.c2p(-1, f(a) + slope * (-1 - a)),
				axes.c2p(2, f(a) + slope * (2 - a)), color=YELLOW,
			)
		secant = always_redraw(secant_line)
		self.add(plot, fixed, secant)
		self.narrate("Two samples give an average slope. Predict as they approach.", run_time=3)
		self.play(sample.animate.set_value(a + 0.03), run_time=6, rate_func=linear)
		self.narrate("The secant settles toward one direction.", run_time=2)
		average = MathTex(r"m", "=", r"\frac{f(a+h)-f(a)}{h}")
		average.scale(0.75).shift(1.7 * DOWN)
		average.set_color_by_tex("m", YELLOW)
		self.add(average)
		self.wait(2)
		limit = MathTex(r"f'(a)", "=", r"\lim_{h\to 0}\frac{f(a+h)-f(a)}{h}", "=", "a")
		limit.set_color(GREEN).scale(0.65).move_to(average)
		secant.clear_updaters()
		tangent = Line(
			axes.c2p(-1, f(a) + a * (-1 - a)),
			axes.c2p(2, f(a) + a * (2 - a)), color=GREEN,
		)
		self.play(FadeOut(secant), Create(tangent), TransformMatchingTex(average, limit))
		self.narrate("For this curve the derivative at a is a. Here it is one half.", run_time=4)
		moving_dot.clear_updaters()
		self.wait(1)
```

This shows a smooth function; it does not prove every function has a derivative.
Use a corner example afterward to test the assumption of a unique limiting slope.
If moving labels crowd the formula, move the plot upward before constructing linked objects.

## Render drafts before polishing

Call `psi_manim` with `{ topic, code: <full Python source>, scene: <exact class name>, quality: "l" }`.
Supply topic explicitly unless an active topic is selected. Direct code renders immediately.
For a saved storyboard, pass `{ topic, storyboardId }` to generate Python only; add `render: true` to render.
Save the storyboard with `psi_storyboard` first. When both code and storyboardId are supplied, the storyboard wins.
Use -ql for drafts, -qm for review, and -qh only after content is stable.
These map to quality "l", "m", and "h" in visual/src/manim.ts renderManim.
For direct CLI use: manim -ql projection.py DotProductProjection.
For the other example: manim -ql derivative.py SecantToTangent.
Keep temporary draft sources and outputs outside the repo unless an artifact location is requested.
Use runner "auto", "local", or "docker" only where supported by the exposed tool.
The default container image is psi-manim:latest; PSI_MANIM_IMAGE can override it.
Inspect RenderResult.ok, outputs, and log rather than assuming a spawned process succeeded.

## Debug rendering failures

LaTeX missing: check latex and dvisvgm; install suitable texlive packages or use psi-manim:latest.
Check the platform's installation instructions before prescribing specific package names.
Cairo/pango errors: check native Cairo/Pango libraries and the Manim Python environment.
Prefer the maintained container when host native libraries are incompatible.
Scene name mismatch: the runner's scene must exactly match DotProductProjection or SecantToTangent.
ffmpeg missing: make ffmpeg available to the rendering process or use the container.
Text font errors: use an installed font, simplify the font choice, and inspect missing glyphs.
Import failure: make python/psi_manim available in the same Python environment as Manim.
Do not call Python syntax validation proof of imports, LaTeX availability, or render success.

## Inspect the mathematical result

- [ ] Linked geometry follows one tracker without drifting away from its mathematical relation.
- [ ] Titles, captions, and formulas fit without overlapping the diagram.
- [ ] The learner gets a pause before the answer or limiting behavior is shown.
- [ ] Colors remain attached to the same objects through the transformation.
- [ ] Degenerate cases are explained rather than hidden by numerical hacks.
- [ ] The displayed formula is correct under the stated assumptions.
- [ ] Draft output was inspected, or the absence of rendering is clearly disclosed.
