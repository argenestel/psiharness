"""Intuition-first animation helpers built on Manim Community."""

from .palette import BG, BLUE, YELLOW, GREEN, RED, GREY, THREE_B_ONE_B, KURZGESAGT
from .scenes import (
	PsiScene, number_line_story, vector_on_plane, transform_grid,
	epicycles, plot_with_tracker, growth_dots,
)

__all__ = [
	"PsiScene", "number_line_story", "vector_on_plane", "transform_grid",
	"epicycles", "plot_with_tracker", "growth_dots", "BG", "BLUE", "YELLOW",
	"GREEN", "RED", "GREY", "THREE_B_ONE_B", "KURZGESAGT",
]
