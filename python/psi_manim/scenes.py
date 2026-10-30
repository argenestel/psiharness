"""Composable Manim objects and a caption-aware scene base.

Builders return objects/trackers/animations without playing them. Add their
objects to your scene, then play the returned animation or animate the tracker.
"""

import math
import numpy as np
from manim import (
	Scene, Text, VGroup, NumberLine, NumberPlane, Arrow, ApplyMatrix,
	ValueTracker, always_redraw, Dot, Axes, Circle, Line, TracedPath,
	UP, DOWN, ORIGIN,
)
from .palette import BG, BLUE, YELLOW, GREEN, GREY


class PsiScene(Scene):
	"""Dark mathematical canvas with readable titles and lower-third captions."""

	def __init__(self, *args, **kwargs):
		super().__init__(*args, **kwargs)
		self.camera.background_color = BG
		self._caption = None

	def title_card(self, text):
		"""Add a title at the top without consuming animation time."""
		title = Text(text, font_size=40).to_edge(UP, buff=0.35)
		self.add(title)
		return title

	def caption(self, text):
		"""Replace the lower-third subtitle without consuming scene time."""
		if self._caption is not None:
			self.remove(self._caption)
		self._caption = None
		if not text:
			return None
		caption = Text(text, font_size=25, line_spacing=0.8)
		if caption.width > self.camera.frame_width - 0.8:
			caption.scale_to_fit_width(self.camera.frame_width - 0.8)
		caption.to_edge(DOWN, buff=0.3).set_z_index(100)
		caption.add_background_rectangle(color=BG, opacity=0.9, buff=0.12)
		self._caption = caption
		self.add(caption)
		return caption

	def narrate(self, text, run_time=2):
		"""Display a subtitle and wait; this helper does not synthesize audio."""
		self.caption(text)
		if run_time > 0:
			self.wait(run_time)


def number_line_story(values=(0, 1, 2, 3), x_range=(-5, 5, 1)):
	"""Return a number line and dots locating the supplied values."""
	line = NumberLine(x_range=x_range, length=11)
	dots = VGroup(*(Dot(line.n2p(value), color=YELLOW) for value in values))
	return VGroup(line, dots)


def vector_on_plane(vector=(2, 1), color=BLUE):
	"""Return a number plane and a vector in its coordinate system."""
	plane = NumberPlane(x_range=(-6, 6, 1), y_range=(-3, 3, 1))
	arrow = Arrow(plane.c2p(0, 0), plane.c2p(*vector[:2]), buff=0, color=color)
	return VGroup(plane, arrow)


def transform_grid(matrix):
	"""Return (grid, ApplyMatrix animation) for a 2×2 linear transformation."""
	matrix = np.asarray(matrix, dtype=float)
	if matrix.shape != (2, 2):
		raise ValueError("matrix must be 2 by 2")
	grid = NumberPlane(background_line_style={"stroke_color": BLUE, "stroke_opacity": 0.55})
	grid.prepare_for_nonlinear_transform()
	return grid, ApplyMatrix(matrix, grid)


def epicycles(coeffs):
	"""Return (circles/arrows, time tracker, traced path).

	Each coefficient is (integer frequency, complex amplitude). Time is measured
	in turns: animate tracker from 0 to 1 for one complete cycle.
	"""
	terms = [(float(freq), complex(amplitude)) for freq, amplitude in coeffs]
	tracker = ValueTracker(0)

	def vertices():
		points = [np.array(ORIGIN, dtype=float)]
		for freq, amplitude in terms:
			z = amplitude * np.exp(2j * np.pi * freq * tracker.get_value())
			points.append(points[-1] + np.array([z.real, z.imag, 0]))
		return points

	def chain():
		points = vertices()
		objects = VGroup()
		for index, (_, amplitude) in enumerate(terms):
			if abs(amplitude) == 0:
				continue
			objects.add(Circle(radius=abs(amplitude), color=GREY, stroke_width=1).move_to(points[index]))
			objects.add(Line(points[index], points[index + 1], color=BLUE))
		objects.add(Dot(points[-1], color=YELLOW, radius=0.05))
		return objects

	objects = always_redraw(chain)
	trace = TracedPath(lambda: vertices()[-1], stroke_color=YELLOW, stroke_width=3)
	return objects, tracker, trace


def plot_with_tracker(fn, x_range=(-3, 3, 1)):
	"""Return (axes/plot/dot group, tracker) for a moving function sample."""
	axes = Axes(x_range=x_range, y_range=(-3, 3, 1), x_length=10, y_length=5)
	curve = axes.plot(fn, color=BLUE)
	tracker = ValueTracker(x_range[0])
	dot = always_redraw(lambda: Dot(axes.c2p(tracker.get_value(), fn(tracker.get_value())), color=YELLOW))
	return VGroup(axes, curve, dot), tracker


def growth_dots(n):
	"""Return n dots in a compact grid, suitable for doubling demonstrations."""
	if not isinstance(n, int) or n < 0:
		raise ValueError("n must be a non-negative integer")
	if n == 0:
		return VGroup()
	dots = VGroup(*(Dot(radius=0.07, color=GREEN) for _ in range(n)))
	dots.arrange_in_grid(cols=math.ceil(math.sqrt(n)), buff=0.14)
	if dots.width > 11 or dots.height > 5:
		dots.scale(min(11 / dots.width, 5 / dots.height))
	return dots
