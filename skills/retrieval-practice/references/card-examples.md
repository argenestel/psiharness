# Thirty focused card drafts

Each numbered JSON object is one draft; concept ids must exist in the destination graph before use.
For explain cards, numbered answer points form a rubric, not wording to memorize.
For mcq cards, the answer identifies the choice and diagnoses every distractor.

1. Math: signed alignment.
```json
{"conceptId":"dot-product-projection","kind":"recall","prompt":"What is the dot product of two perpendicular vectors?","answer":"Zero."}
```
2. Physics: inertia.
```json
{"conceptId":"inertial-motion","kind":"recall","prompt":"In an inertial frame, what happens to an object's velocity when the net force on it is zero?","answer":"Its velocity remains constant, including the possibility of remaining at rest."}
```
3. CS: stack discipline.
```json
{"conceptId":"stack-order","kind":"recall","prompt":"A stack removes items in what order relative to insertion?","answer":"Last in, first out."}
```
4. Biology: genetic information.
```json
{"conceptId":"dna-base-pairing","kind":"recall","prompt":"In ordinary double-stranded DNA, which base pairs with adenine?","answer":"Thymine."}
```
5. History: evaluating accounts.
```json
{"conceptId":"historical-corroboration","kind":"recall","prompt":"What is corroboration in historical source analysis?","answer":"Comparing independent evidence to check a claim."}
```
6. Economics: forgone alternatives.
```json
{"conceptId":"opportunity-cost","kind":"recall","prompt":"What is the opportunity cost of a choice?","answer":"The value of the best alternative forgone."}
```
7. Language: morphology.
```json
{"conceptId":"english-past-tense","kind":"recall","prompt":"What is the simple past form of the English verb 'go'?","answer":"Went."}
```
8. Music: intervals.
```json
{"conceptId":"octave-frequency-ratio","kind":"recall","prompt":"What frequency ratio defines an octave above a tone?","answer":"2:1."}
```
9. Math: scaling area.
```json
{"conceptId":"area-scaling","kind":"predict","prompt":"A square's side length triples. By what factor does its area change?","answer":"It becomes nine times as large because area scales as side length squared."}
```
10. Physics: resistance.
```json
{"conceptId":"ohms-law","kind":"predict","prompt":"For an ideal resistor with fixed resistance, voltage doubles. What happens to current?","answer":"It doubles, since I = V/R."}
```
11. CS: aliasing.
```json
{"conceptId":"mutable-aliasing","kind":"predict","prompt":"Two variables refer to the same mutable list. One variable is used to append an item. What does the other variable see?","answer":"The appended item, because both variables refer to the same list."}
```
12. Biology: osmosis.
```json
{"conceptId":"osmosis-direction","kind":"predict","prompt":"Two solutions differ only in the concentration of an impermeant solute and are separated by a water-permeable membrane. With equal pressure, which way does water initially move on net?","answer":"Toward the more concentrated solution, where the solute lowers water's chemical potential."}
```
13. Economics: demand shifts.
```json
{"conceptId":"demand-shift","kind":"predict","prompt":"Demand increases while an upward-sloping supply curve stays fixed. In the usual competitive model, what happens to equilibrium price?","answer":"It rises as the intersection moves upward along the supply curve."}
```
14. Chemistry: dilution.
```json
{"conceptId":"dilution-concentration","kind":"predict","prompt":"A nonreacting solute's amount stays fixed while solution volume doubles. What happens to molar concentration?","answer":"It halves, because concentration is amount divided by volume."}
```
15. Statistics: sample mean precision.
```json
{"conceptId":"standard-error-scaling","kind":"predict","prompt":"For independent identically distributed observations with finite variance, sample size rises from n to 4n. What happens to the standard error of the sample mean?","answer":"It halves because the standard error is sigma divided by the square root of sample size."}
```
16. Music: stretched strings.
```json
{"conceptId":"string-length-pitch","kind":"predict","prompt":"For an ideal vibrating string at fixed tension and linear density, vibrating length halves. What happens to the fundamental frequency?","answer":"It doubles because the fundamental frequency is inversely proportional to length."}
```
17. Math: eigenvectors.
```json
{"conceptId":"eigenvector-line","kind":"explain","prompt":"Why does an eigenvector stay on its original line under its matrix transformation?","answer":"1. An eigenvector v is nonzero and satisfies Av = lambda v. 2. A scalar multiple lies on the same line, including zero when lambda is zero."}
```
18. CS: binary search.
```json
{"conceptId":"binary-search-elimination","kind":"explain","prompt":"Why can binary search discard the left side when the target exceeds the middle item?","answer":"1. The list is sorted in ascending order. 2. Every value to the left is no larger than the middle item, so none can equal the larger target."}
```
19. Biology: natural selection.
```json
{"conceptId":"selection-mechanism","kind":"explain","prompt":"How can a heritable trait become more common through natural selection?","answer":"1. Individuals vary in the trait and pass it to offspring. 2. In the current environment, the trait is associated with greater reproductive success. 3. Carriers consequently contribute more copies to later generations; need or intention is not required."}
```
20. History: independent evidence.
```json
{"conceptId":"source-independence","kind":"explain","prompt":"Why do two newspapers copying the same eyewitness report not provide two independent confirmations?","answer":"1. Both claims depend on one underlying account. 2. An error in that account can therefore appear in both newspapers without a second observation."}
```
21. Economics: compounding.
```json
{"conceptId":"compound-interest","kind":"explain","prompt":"Why does a balance earning a fixed positive compound interest rate gain more money in later equal periods, with no deposits or withdrawals?","answer":"1. Each period's interest is added to the balance. 2. The same rate is then applied to a larger balance, increasing the absolute interest gain."}
```
22. Chemistry: catalysts.
```json
{"conceptId":"catalyst-rate","kind":"explain","prompt":"Why can a catalyst speed a reaction without changing its equilibrium constant at fixed temperature?","answer":"1. It provides an alternative pathway with a lower activation barrier. 2. It speeds approach to equilibrium in both directions without changing the reactant-product free-energy difference."}
```
23. Statistics: confounding.
```json
{"conceptId":"confounding","kind":"explain","prompt":"Why does an association between ice-cream sales and drowning not establish that ice cream causes drowning?","answer":"1. A common factor such as hot weather can increase both sales and swimming exposure. 2. The association alone does not isolate an effect of ice cream on drowning."}
```
24. Math: signed derivatives.
```json
{"conceptId":"derivative-at-peak","kind":"mcq","prompt":"For y = sin(x), with x in radians, what is the derivative at x = pi/2?","choices":["1, because the height is 1","0, because the tangent is horizontal","-1, because sine must immediately fall"],"answer":"0, because the tangent is horizontal. Height 1 is not slope; -1 confuses the negative slopes later on the curve with the slope at the peak."}
```
25. Physics: mass and weight.
```json
{"conceptId":"mass-versus-weight","kind":"mcq","prompt":"An object moves from Earth to a place with weaker gravity, without losing matter. What happens to its mass?","choices":["It decreases with gravitational force","It increases to compensate for weaker gravity","It stays the same"],"answer":"It stays the same. Gravitational force changes weight, not mass; no compensating mass increase occurs."}
```
26. CS: empty-list truth.
```json
{"conceptId":"universal-quantification","kind":"mcq","prompt":"For a predicate P, what is 'every element of the empty list satisfies P'?","choices":["True, because there is no counterexample","False, because no element demonstrates P","Undefined, because P was never evaluated"],"answer":"True, because there is no counterexample. A universal claim needs no witnessing element; its truth is defined even when P is never evaluated."}
```
27. Biology: population evolution.
```json
{"conceptId":"evolution-population","kind":"mcq","prompt":"Which observation directly describes genetic evolution in a population?","choices":["An individual grows larger with age","An allele's frequency changes across generations","Every individual tries harder to survive"],"answer":"An allele's frequency changes across generations. Growth is individual development; effort is not itself a change in population allele frequencies."}
```
28. Language: grammatical form.
```json
{"conceptId":"english-third-person-agreement","kind":"mcq","prompt":"Which sentence uses standard English present-tense third-person singular agreement?","choices":["She walk daily.","She walking daily.","She walks daily."],"answer":"She walks daily. 'Walk' lacks third-person singular agreement here; 'walking' requires a finite auxiliary such as 'is' and expresses a different construction."}
```
29. Chemistry: ionic charge.
```json
{"conceptId":"electron-loss-charge","kind":"mcq","prompt":"A neutral atom loses one electron and nothing else. What is its net charge?","choices":["Positive one elementary charge","Negative one elementary charge","Zero"],"answer":"Positive one elementary charge. Losing negative charge leaves an excess positive charge; negative would fit gaining an electron, and zero would require no net charge change."}
```
30. Statistics: p-values.
```json
{"conceptId":"p-value-meaning","kind":"mcq","prompt":"Under the specified null model and assumptions, what does a p-value summarize?","choices":["The probability the null hypothesis is true","The probability of a test statistic at least as extreme as observed","The probability the result will replicate"],"answer":"The probability of a test statistic at least as extreme as observed, under the null model and its specified tail rule. It is not a posterior probability that the null is true, nor a replication probability."}
```
