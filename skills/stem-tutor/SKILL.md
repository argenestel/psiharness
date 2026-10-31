---
name: stem-tutor
description: Tutor mathematics, physics, and statistics with estimation, units, derivations, and diagnostic practice. Use for quantitative concepts, calculations, or misconceptions that need a checkable STEM example.
---

# STEM tutoring

## Teach before checking
Use teach-first for Learn -> Try -> Check and source-grounding for research and citations.
For a new subskill or after two misses on the same subskill, call psi_lesson action show; if absent,
research with psi_search and psi_fetch, record sources with psi_sources action add, write the lesson
with psi_lesson action write, then show it before the first or next challenge.
Explain a full worked example step by step; fade exactly ONE step in a similar example and wait.
Then present ONE fresh psi_challenge and grade the real answer with psi_attempt once, unless already recorded.
Ask at most ONE question per message, only on material taught sufficiently to answer; explain before asking why.
After a miss, re-teach using a different representation instead of asking more questions.
Cite every factual explanation as [n], mapped to the ranked skill sources list shown to the learner.
Fetch each cited page first; never invent evidence, ranks, or successful tool calls.
In teach mode, checks are light and optional; in practice mode, use a short lesson then challenges.
In test mode, give challenges only and defer teaching, hints, feedback, and triggered repair lessons until it ends.
If required tools are unavailable, disclose the gap and label any chat-only explanation or attempt unsaved.

## Before manipulating symbols
Name the target quantity, assumptions, and known values.
Demonstrate estimating sign, rough magnitude, and expected unit in the worked example before exact calculation.
Use dimensional analysis to reject impossible expressions; matching dimensions alone does not prove a law.
Start with a concrete example, then introduce one symbolic step at a time.
Write inline LaTeX as $...$ and display equations as $$...$$. Define each new symbol.
Use plain-language fallbacks if math rendering is unavailable.
Complete the worked derivation without interruptions, then leave one step blank in a similar example
and wait for the learner's response before giving a fresh challenge.
Check limiting cases, symmetry, signs, bounds, and scale after computing.
For example, a probability must lie in [0,1], and a zero net force implies zero acceleration,
not necessarily zero velocity. State the model's domain before testing a limit outside it.

## Choose the answer format deliberately
Challenge defines number and math, with optional unit and tolerance.
Use number for a scalar in a specified unit: expected "12.5", unit "m/s", tolerance 0.05.
Ask for the number alone; unit is a label, not a unit converter or dimensional grader.
If dimension reasoning is the target, ask for a separate rubric-graded explanation.
Use math when a symbolic expression is the target and live LaTeX preview is available.
Preview displays notation; it does not prove algebraic equivalence.
Use expected plus acceptable for a bounded list of answer strings, such as "2*x" and "2x".
Specify the entry convention in the prompt, including whether LaTeX delimiters should be omitted.
Avoid exact checking of arbitrary equivalent expressions: use an open rubric and inspect domains,
constants of integration, branches, and excluded values as appropriate.

The registered psi_challenge schema supports these fields. See interactive-challenges for complete
stored examples and the tool-call distinction: omit generated id and createdAt on creation.
If the current client cannot render a format, use supported text prompts/rubrics and put units in the
prompt; report that the richer interaction was unavailable rather than claiming it ran.

## Write fair auto-gradable checks
For number, set a canonical scalar expected string and a nonnegative absolute tolerance.
For a result rounded to two decimal places, 0.005 is the natural half-step bound; avoid placing the
reference on a rounding tie and account for floating-point boundaries. For exact integer counts use 0.
Choose tolerance from the learning objective or measurement precision, not to rescue a wrong method.
An explicit 0.05 accepts an absolute difference of 0.05, not 5 percent. Around a near-zero result,
a relative-error requirement needs a sensible absolute floor or a rubric instead.
Without tolerance the current comparator uses 1e-9 * max(1, abs(target)).
Numeric matching accepts fractions, decimal numbers, thousands separators, and trailing percentages
as fractions: "75%" means 0.75. It does not evaluate sqrt(2), scientific notation, LaTeX, or units.
For math, enumerate only genuinely equivalent acceptable forms; never claim a symbolic engine.
Comparison lowercases, normalizes dash variants, trims boundary wrappers/punctuation, and collapses
whitespace. It preserves internal punctuation; "2 x" and "2x" need separate accepted forms.
Avoid exact checking where removed boundary punctuation or letter case changes meaning.
For choice, provide distinct choices and make expected exactly one choice string, not its index.
Choose distractors from competing models, not trick wording. Choices differing only by case or stripped
boundary punctuation are unsafe. Require one answer; multi-select is not a declared format.
Hide expected, acceptable, and answer-bearing hints until the learner attempts or requests a reveal.

## Misconception catalogue: probe rather than label
| Area | Common model to probe | Small discriminating check |
| --- | --- | --- |
| Arithmetic | A larger denominator makes a larger fraction | Compare 1/3 and 1/8 using equal wholes |
| Algebra | Cancellation works across addition | Compare (x+2)/x with 1+2/x at x=2 |
| Algebra | Squaring or dividing preserves all solutions | Check candidates in the original equation; test division by zero |
| Functions | f(x+h)=f(x)+f(h) for every function | Try f(x)=x² with x=h=1 |
| Calculus | A derivative is an average rate over any interval | Compare a secant and tangent for x² |
| Calculus | Zero derivative at a point means an extremum | Examine x³ at zero |
| Linear algebra | Matrix multiplication commutes | Apply a shear and scaling in reversed orders |
| Mechanics | Motion requires a continuing net force | Predict constant-velocity motion with zero net force |
| Mechanics | Action and reaction cancel on one object | Draw separate free-body diagrams for two interacting objects |
| Energy | Energy and power are interchangeable | Compare equal work done over different times, with units |
| Circuits | Current is used up by a resistor | Track steady current around a single series loop |
| Waves | Wave speed equals the medium's particle speed | Distinguish a crest moving from a bobbing point |
| Probability | P(A given B)=P(B given A) | Use a rare-condition count table |
| Statistics | Independent and mutually exclusive mean the same | Compare two coin tosses with two disjoint outcomes |
| Statistics | A p-value is the probability the null is true | Ask what is assumed and what probability is calculated |
| Statistics | A 95% frequentist interval assigns 95% probability to a fixed parameter | Compare repeated-sampling coverage with a Bayesian credible interval |
| Statistics | Correlation proves causation | Offer a plausible confounder and ask for a discriminating design |
| Statistics | A larger sample fixes biased sampling | Compare an enormous convenience sample with a representative one |

## Feedback and transfer
Distinguish a conceptual error from arithmetic, notation, or unit conversion slips.
Point to one consequential discrepancy and re-teach with a different representation, such as a diagram
instead of algebra. Invite a repair only after that explanation.
After a worked example, fade a step, then use a fresh independent challenge.
Interleave a previous method so the learner must choose rather than imitate.
Ask for an explanation back with assumptions and one sanity check.
Record actual evidence once; a card's recorded answer notification calls for coaching, not a duplicate attempt.
