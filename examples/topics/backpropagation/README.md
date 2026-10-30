# Backpropagation

Training a network is a walk downhill on a landscape of loss. The forward pass measures how wrong the current weights are. The backward pass starts with one unit of blame at the loss and multiplies it by each local derivative on the way back, which is the chain rule run in reverse, so every weight learns how much it contributed. Each weight then steps against its gradient by an amount set by the learning rate.

## The aha path

- Picture every setting of the weights as a place whose height is the loss. Learning means taking informed steps downhill.
- Make the loss a single scoreboard number, then write the model as a composition: h = w₁x, ŷ = w₂h, L = ½(ŷ − y)².
- Use derivatives as local speedometers. The chain rule says sensitivities multiply along a route, and partial derivatives isolate one knob at a time.
- Stack the partials into the gradient, an uphill compass, and walk against it. The learning rate decides whether you crawl, converge, overshoot, or diverge.
- Turn the formula into a computation graph and run it forward (x = 1, w₁ = 2, w₂ = 0.5 gives ŷ = 1 and L = 2 against y = 3).
- Run it backward: ∂L/∂ŷ = −2, ∂L/∂w₂ = −2·h = −4, ∂L/∂h = −2·w₂ = −1, ∂L/∂w₁ = −1·x = −1. One sweep gives every gradient.
- Step with η = 0.1: w₁ → 2.1 and w₂ → 0.9, so the loss falls from 2 to about 0.62. Repeat.

## Concepts

- `descending-loss-valley`: The descending loss valley
- `loss`: Loss as the training objective
- `composition`: Composition of functions
- `derivatives`: Derivatives as local slope
- `chain-rule`: The chain rule
- `partial-derivatives`: Partial derivatives
- `gradient`: The gradient
- `gradient-descent`: Gradient descent
- `computation-graph`: Computation graphs
- `forward-pass`: The forward pass
- `backward-pass`: The backward pass and reverse mode
- `weight-updates`: Weight updates and learning rate

## Watch

`storyboards/how-a-network-blames-its-weights.json` is a 9-scene 3Blue1Brown-style explainer (about 92 s) built on the worked example above. It shows the four-node network, the forward pass with cached values, the loss valley along w₂ with its tangent slope of −4, blame starting at the loss, the chain-rule equation for ∂L/∂w₂, blame flowing back to w₁, the gradient vector against the valley floor w₁w₂ = 3 in weight space, one update step, and a zoom out to a layered network. It is attached to the `backward-pass` lesson.

## Explore

`explorables/gradient-step-loss.json` uses the `function-plot` template. The yellow curve is the loss L(w) = (curv/2)(w − 2)² + 0.5. The dashed blue `compare` curve draws a caret above each weight visited by gradient descent. It uses the closed form wₖ = 2 + (w₀ − 2)(1 − η·curv)ᵏ, with one caret per step k up to the `steps` slider (at most 10). This keeps it within the renderer's expression syntax, which has no loops. Sliders: `lr` (η), `steps`, `w0`, `curv`. Steps converge smoothly for η·curv < 1, land on the minimum in one step at η·curv = 1, oscillate but converge between 1 and 2, and diverge past η = 2 / curv.

## Notes

The prerequisite of `loss` was changed from `gradient` to `descending-loss-valley`, and the plan now teaches it second. Its lesson introduces the scoreboard before any direction exists, and a difficulty-2 objective should not depend on the difficulty-3 gradient.

## Import

```sh
psi import examples/topics/backpropagation
```
