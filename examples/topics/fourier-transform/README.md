# Fourier transform

Every sound is a sum of circles. A single spinning arrow traces a circle, and its height rises and falls as a pure tone. Chain arrows tip to tail and the last tip can trace square waves, hearts, almost any closed loop. The Fourier transform runs that recipe backward: it measures how long the arrow must be, and where it must start, at every speed. Once a signal is written as frequencies, filtering is just choosing which arrows survive.

## The aha path

- Watch a chain of rotating arrows draw a shape. Only the last tip draws; the circles are scaffolding.
- Turn the arrows into numbers: complex multiplication rotates, and `c·e^{iωt}` is a clock hand with explicit length, speed and starting angle.
- Look at a rotor edge-on to get a sinusoid. Its length sets amplitude, its speed sets frequency, its starting angle sets phase.
- Build a rhythm detector: multiply by a reference wave and average. Matching rhythms survive; mismatched ones cancel (orthogonality).
- Project onto every harmonic to get a Fourier series. Let the period grow without bound to get the continuous transform.
- Zoom out to filtering: convolution in time becomes multiplication in frequency.

## Concepts

- `rotating-vectors-draw-anything`: Rotating vectors can draw shapes (hook)
- `complex-numbers`: Complex numbers are points with a built-in turn
- `rotating-vectors`: A rotating vector is a complex exponential
- `sinusoids`: Sinusoids are shadows of rotation
- `frequency-intuition`: Frequency is the pace of repetition
- `inner-product-with-sinusoid`: Correlating with a sinusoid measures its ingredient
- `orthogonality`: Different frequencies can be perpendicular
- `fourier-series`: Fourier series rebuild periodic signals
- `continuous-fourier-transform`: The Fourier transform scans a continuum of frequencies
- `convolution-filtering`: Convolution filters by multiplying spectra

There are 40 retrieval cards, four per concept, split evenly between recall, predict, explain and multiple choice. Every lesson's `checks` lists that concept's four card ids.

## Watch

`storyboards/rotating-vectors-draw-anything.json` is "Every sound is a sum of circles": eight Kurzgesagt-style scenes, about 84 seconds in total.

1. Air wiggles: a messy pressure wave and a curious listener.
2. One spinning arrow whose tip height traces a pure tone, `h(t) = A cos(ωt)`.
3. Two dials: a longer arrow is louder, a faster arrow is higher in pitch.
4. Three arrows stacked tip to tail. The arm lengths are 1 : 1/3 : 1/5, the absolute speeds are 1 : 3 : 5, and the middle arm starts pointing down. Together they draw the first three terms of a square wave. Nested `orbit` loops add their rotations, so the inner groups spin at the speed *differences*: periods of 6 s, 3 s and 3 s.
5. With 1, 3 and 12 circles the curve closes in on a square wave. A small overshoot (the Gibbs phenomenon) stays at each jump.
6. The same circles draw a heart in 2D. The chain is frozen a tenth of the way round the outline. It uses the eight largest DFT coefficients of the heart, so its tip sits on the curve.
7. Running it backward: the transform turns the scene-1 wave into three spectrum bars with heights 1, 0.5 and 0.35, the true amplitudes of its components.
8. Zoom out: inner ear, MP3/JPEG, MRI.

Render it with `psi render examples/topics/fourier-transform/storyboards/rotating-vectors-draw-anything.json -o sum-of-circles.html`.

Only the hook lesson has a finished storyboard. Later lessons list their storyboards with no `path`, which means they are planned but not yet made.

## Explore

`explorables/circles-draw-a-heart.json` uses the `fourier-epicycles` template with `shape: "heart"`. The renderer samples the outline at 128 points and takes its discrete Fourier transform. It then sorts the coefficients by amplitude and keeps the largest `terms` of them; each coefficient's frequency keeps its sign, so some circles spin clockwise and some counterclockwise. The dashed curve is the full reconstruction from those terms. The yellow trail is the pen. `speed` only scales playback time. The fourier-series lesson reuses this lab.

## Import

```sh
psi import examples/topics/fourier-transform
```
