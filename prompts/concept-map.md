---
description: Map prerequisites and identify concepts ready to learn next. Use when planning a learning route through a topic.
argument-hint: "<topic>"
---
Produce a prerequisite concept map for $1.
If the topic is missing, ask for it and wait.
Read its existing graph and learner mastery record when available.
State the big idea and keep the map focused on reaching it.
Use stable kebab-case ids and concise human-readable titles.
Draw a Mermaid graph with edges directed from prerequisite to dependent concept.
Use safe Mermaid node identifiers and quoted labels for punctuation-heavy titles.
Include only necessary prerequisites; avoid a map of every adjacent subject.
Check for cycles, duplicate ids, and references to missing concepts.
Mark demonstrated mastery separately from unknown or untested knowledge.
List frontier concepts: unmastered nodes whose prerequisites are all mastered.
If mastery evidence is absent, label a provisional frontier assuming none mastered.
Under that assumption, start with nodes that have no prerequisites.
For a requested target, identify a topological route through its unmet prerequisites.
Recommend one next concept and one short diagnostic question.
