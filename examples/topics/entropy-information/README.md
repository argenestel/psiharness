# Entropy and information

Information is surprise you can count. An outcome with probability p carries −log₂ p bits, which is the number of fair yes-or-no questions needed to single it out. Entropy is the average of that surprise over a source. The same measure explains compression, prediction scores, dependence between variables, the cost of a wrong model, and the speed limit of a noisy channel.

## The aha path

- Hold a spinning coin over two open doors. When it lands, one door closes, and that answer is worth one bit.
- Roll a die (six doors, about 2.58 bits), then pick 1 of 1,024 (10 bits). Rarer news is louder news.
- Plot −log₂ p. Each halving of probability adds one bit, and the logarithm makes independent surprises add.
- Load the coin to 0.9/0.1. Weight each outcome's surprise by how often it occurs: 0.47 bits per flip, not 3.32.
- Sweep the bias to trace the entropy hill: 1 bit at a fair coin, 0 at certainty. Entropy belongs to the distribution, not to one outcome.
- Score a wrong forecast (cross-entropy), subtract the unavoidable part (KL divergence), and split a pair of variables into what is shared (mutual information) and what is left over (conditional entropy).
- End at channel capacity: redundancy buys reliability, up to a rate set by mutual information.

## Concepts

- `coin-flips`: Coin flips as a playground for uncertainty
- `probability`: Probability assigns weight to possibilities
- `surprise`: Surprise is minus log probability
- `expected-surprise`: Expected surprise averages outcomes
- `entropy`: Entropy is average uncertainty
- `bits`: Bits count binary alternatives
- `cross-entropy`: Cross-entropy scores a predictive model
- `joint-entropy`: Joint entropy counts pairs together
- `conditional-entropy`: Conditional entropy is uncertainty left over
- `mutual-information`: Mutual information measures shared knowledge
- `kl-divergence`: KL divergence is the cost of a wrong model
- `channel-coding-intuition`: Redundancy can defeat a noisy channel

## Watch

`storyboards/surprise-is-information.json` is a 9-scene Kurzgesagt-style explainer (about 92 s): two doors and a coin, six doors for a die, one glowing particle among 1,024, the −log₂ p curve, two coins as a two-level question tree, a loaded coin's weighted surprises, the binary-entropy hill, and a zoom out to gases, text and codes. It covers the first six lessons. The later lessons' storyboards are planned (no `path` yet).

## Explore

`explorables/coin-flip-information-lab.json` uses the `probability-sim` template with `experiment: "coin"`. Slider `p` is p(heads), and `trials` is flips per animation tick. The histogram shows observed proportions: bar 0 is tails and bar 1 is heads. The yellow line is the model's expected distribution. The renderer does not print entropy, so the prompts give the numbers to check by hand: 1 bit at p = 0.5, about 0.47 bits at 0.9, and about 0.08 bits at 0.99.

## Import

```sh
psi import examples/topics/entropy-information
```
