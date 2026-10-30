# Exponential growth

Constant proportional change can turn a tiny beginning into a crowded world. The last doubling contributes half the final amount; that surprise comes from multiplication, not magic.

## The aha path

- Run the bottle puzzle backward: noon full, 11:40 half, 11:20 quarter.
- Replace constant additions with multipliers, then count doublings and compound interest.
- Zoom into continuous rates and straighten growth on a logarithmic axis.
- Build transmission generations; distinguish reproduction numbers from daily rates.
- Add resource feedback, reverse growth into half-life decay, and check model limits.

## Concepts

- `last-doubling-fills-the-bottle` — The last doubling fills the bottle
- `multiplicative-growth` — Multiplication instead of addition
- `doubling-time` — Doubling time is a clock
- `compound-interest` — Interest earns interest
- `continuous-growth` — Continuous growth and e
- `logarithmic-scale` — A log scale turns ratios into distances
- `reproduction-number` — Epidemics as branching generations
- `logistic-saturation` — Resources bend the curve
- `half-life-decay` — Decay uses the same machinery
- `limits-and-models` — Know when the model stops working

## Explore

`explorables/doubling-laboratory.json` uses the renderer's documented `exponential-growth` parameter `mode: "doubling"`. The renderer starts at 1 and plots `2^(rate × steps)` against a blue linear reference `1 + rate × steps`. Here one step means 20 minutes; `rate` is doublings per step, not a fractional percent increase. The curves need not have matching initial slopes. `steps` is the time horizon. Required slider `capacity` is ignored in doubling mode; switching the JSON mode to `logistic` activates it, uses continuous logistic rate `rate`, and also changes the exponential comparison to `(1+rate)^steps`. The display caps population dots at 1,024. The bottle narrative assumes an ideal abrupt capacity cutoff; the later logistic lesson deliberately replaces that assumption with gradual feedback.

## Import

```sh
psi import examples/topics/exponential-growth
```
