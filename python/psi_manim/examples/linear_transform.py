"""A shear: watch the whole grid move, not just one vector."""
from manim import Create
from psi_manim import PsiScene, transform_grid


class LinearTransform(PsiScene):
	def construct(self):
		self.title_card("A matrix moves space")
		grid, shear = transform_grid([[1, 1], [0, 1]])
		self.play(Create(grid), run_time=1)
		self.caption("Each horizontal slice slides in proportion to its height.")
		self.play(shear, run_time=3)
		self.narrate("Straight lines stay straight. The grid reveals the rule.", run_time=2)
