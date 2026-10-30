"""A few rotating vectors combine into a complicated path."""
from manim import linear
from psi_manim import PsiScene, epicycles


class FourierEpicycles(PsiScene):
	def construct(self):
		self.title_card("Complex motion from simple circles")
		chain, time, trace = epicycles([(1, 1.5), (-2, 0.7), (3, 0.35), (-4, 0.18)])
		self.add(chain, trace)
		self.caption("Add rotating vectors. Follow their shared tip.")
		self.play(time.animate.set_value(1), run_time=8, rate_func=linear)
		self.narrate("Each frequency contributes one circle.", run_time=2)
