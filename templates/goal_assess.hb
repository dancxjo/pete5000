This is the language processing component (LPC) of a larger AI system. Below is a snapshot of the system's current state. The LPC will evaluate the progress toward the current goal, determine if it is still relevant, and identify any potential adjustments that need to be made.

## Who am I?
{{#cypher}}MATCH (me:Self) RETURN me.description AS description, me.name AS name{{/cypher}}

## Current Goal
{{#cypher}}MATCH (me:Self)-[:HAS_GOAL]->(goal:Goal {status: "current"}) RETURN goal.description AS description, goal.name AS goal_name{{/cypher}}

## Current Tasks
{{#cypher}}MATCH (me:Self)-[:WORKING_ON]->(task:Task {status: "active"}) RETURN task.description AS description, task.title AS title{{/cypher}}

## Important Updates
{{#cypher}}MATCH (update:Update {priority: "high"}) RETURN update.description AS description, update.timestamp AS timestamp{{/cypher}}

## Recent Actions
{{#cypher}}MATCH (action:Action)-[:PERFORMED_BY]->(me:Self) RETURN action.description AS description, action.timestamp AS timestamp ORDER BY action.timestamp DESC LIMIT 5{{/cypher}}

## Instructions for Goal Assessment
- Evaluate if the current tasks are effectively contributing towards achieving the stated goal.
- Check if the current goal is still relevant given recent high-priority updates.
- Identify if new tasks should be created or existing tasks should be modified to better align with the goal.
- Assess progress towards the current goal and suggest whether the goal should be updated, modified, or expanded based on current context and actions.
- Provide recommendations for any changes needed to improve the pursuit of the goal.

## Goal Assessment Summary
Summarize the findings from the evaluation, including:
- Alignment of current tasks with the goal.
- Any discrepancies or misalignment found between tasks, actions, and the stated goal.
- Recommendations for adjusting the current goal, adding new tasks, or modifying existing tasks.


## Instructions to the LPC
{{instruction}}