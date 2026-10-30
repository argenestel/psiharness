# ψ Manim helpers

`psi_manim` provides dark, 3Blue1Brown-inspired scenes and a Kurzgesagt palette
for **Manim Community**, not ManimGL. Python 3.10+ and `manim>=0.18` are required.
Manim also needs Cairo/Pango and FFmpeg; `MathTex` needs a working LaTeX installation.

From the repository root:

```sh
python -m pip install ./python/psi_manim
manim -ql --media_dir /tmp/psi-linear python/psi_manim/examples/linear_transform.py LinearTransform
manim -ql --media_dir /tmp/psi-fourier python/psi_manim/examples/fourier_epicycles.py FourierEpicycles
```

Alternatively, leave the package uninstalled and set `PYTHONPATH="$PWD/python"`:

```sh
PYTHONPATH="$PWD/python" uv run --with manim manim -ql --media_dir /tmp/psi-linear python/psi_manim/examples/linear_transform.py LinearTransform
```

`PsiScene.title_card(text)` and `caption(text)` add text without consuming time.
`narrate(text, run_time)` replaces the caption and waits exactly that long; it
provides subtitles, not speech synthesis. Caption text uses Pango, not LaTeX.

Builders compose with ordinary Manim objects and animations:

| Builder | Returns |
| --- | --- |
| `number_line_story(values, x_range)` | VGroup containing a number line and value dots |
| `vector_on_plane(vector, color)` | VGroup containing a plane and arrow |
| `transform_grid(matrix)` | `(grid, ApplyMatrix animation)`; add/create grid before playing animation |
| `epicycles(coeffs)` | `(chain, ValueTracker, TracedPath)`; coefficients are `(frequency, complex amplitude)` |
| `plot_with_tracker(fn, x_range)` | `(plot group, ValueTracker)`; animate tracker through x range |
| `growth_dots(n)` | VGroup containing n dots in a compact grid |

Add the returned objects before animating trackers, so their updaters run.
The epicycle tracker measures turns: 0 → 1 draws one period for integer frequencies.
`THREE_B_ONE_B` and `KURZGESAGT` are dictionaries of hex colors; the base scene
uses the first palette's `#0f0f0f` background. Scenes may override
`self.camera.background_color` for a different palette.

The TypeScript runner in `visual/src/manim.ts` sets `PYTHONPATH` automatically,
uses a ten-minute timeout, and can fall back to the `psi-manim:latest` Docker
image (`PSI_MANIM_IMAGE` overrides its name). Storyboard entry animations map
onto Manim; SVG paths, creatures and particles use simple placeholders.
Camera moves, exit/loop animations and exact browser typography are not reproduced.
