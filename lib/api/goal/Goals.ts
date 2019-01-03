/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as _ from "lodash";
import { Locking } from "./common/Locking";
import {
    Goal,
    GoalDefinition,
    GoalWithPrecondition,
} from "./Goal";

/**
 * Represents goals set in response to a push
 */
export class Goals {

    public readonly goals: Goal[];

    /**
     * Return a Goal set that contains these goals and one more goal,
     * with an appropriate name
     * @param {Goal} g goal to add
     * @return {Goals}
     */
    public and(g: Goal): Goals {
        return new Goals(this.name + ", " + g.name, ...this.goals.concat(g));
    }

    /**
     * Return a form of these goals that is locked, so that more goals cannot be
     * added through contribution model
     * @return {Goals}
     */
    public andLock(): Goals {
        return this.and(Locking);
    }

    // tslint:disable-next-line:no-shadowed-variable
    constructor(public name: string, ...goals: Goal[]) {
        this.goals = goals;
    }
}

export function isGoals(a: any): a is Goals {
    return !!a && !!(a as Goals).goals;
}

/**
 *  Builder to build Goals instances.
 */
export interface GoalsBuilder {

    /**
     * Plan the given goal or goals to this Goals instance.
     * @param {GoalDefinition | Goal | Goals} goals
     * @returns {Goals & GoalsAndPreConditionBuilder}
     */
    plan(...goals: Array<GoalDefinition | Goal | Goals>): Goals & GoalsAndPreConditionBuilder;

}

/**
 * Extension to GoalsBuilder allowing to add preConditions.
 */
export interface GoalsAndPreConditionBuilder extends GoalsBuilder {

    /**
     * Add preCondition(s) to previously planned goal or goals.
     * Note:
     * This only will affect the goal or goals that were planned immediately
     * before calling `after`.
     * Only call this once; an additional call will remove other preconditions
     * that may have existed on the original goal.
     * @param {Goal} goals
     * @returns {Goals & GoalsBuilder}
     */
    after(...goals: Array<Goals | GoalDefinition | Goal>): Goals & GoalsBuilder;

}

/**
 * Create Goals instance using a fluent API.
 *
 *  const simpleGoals = goals("Simple Goals")
 *     .plan(CodeInspectionGoal)
 *     .plan(BuildGoal, Autofix).after(CodeInspectionGoal)
 *     .plan(StagingEndpointGoal).after(BuildGoal)
 *     .plan(ProductionDeploymentGoal).after(BuildGoal, StagingEndpointGoal);
 *
 * @param {string} name
 * @returns {Goals & GoalsBuilder}
 */
export function goals(name: string): Goals & GoalsBuilder {
    return new DefaultGoalsBuilder(name);
}

class DefaultGoalsBuilder extends Goals implements GoalsBuilder, GoalsAndPreConditionBuilder {

    private lastGoals: Goal[] = [];

    constructor(public name: string) {
        super(name);
    }

    public plan(...newGoals: Array<GoalDefinition | Goal | Goals>): Goals & GoalsAndPreConditionBuilder {
        const currentGoals = [];

        // Keep track of what goals where last added so that we can add the preConditions later
        convertToGoals(...newGoals).forEach(g => {
            if (isGoals(g)) {
                currentGoals.push(...g.goals);
            } else {
                currentGoals.push(g);
            }
        });
        this.goals.push(...currentGoals);
        this.lastGoals = currentGoals;

        return this;
    }

    public after(...newGoals: Array<Goals | GoalDefinition | Goal>): Goals & GoalsBuilder {
        const lastGoalsWithPreConditions = [];

        this.lastGoals.forEach(g => {
            // Add the preCondition into the last added goals
            lastGoalsWithPreConditions.push(new GoalWithPrecondition(g.definition, ...convertToGoals(...newGoals)));
            // Remove the previously added goals
            const ix = this.goals.indexOf(g);
            if (ix >= 0) {
                this.goals.splice(ix, 1);
            } else {
                throw new Error("Unable to remove previously planned goal");
            }
        });

        // Add the newly created goals with preConditions
        this.goals.push(...lastGoalsWithPreConditions);
        this.lastGoals = lastGoalsWithPreConditions;

        return this;
    }

}

function convertToGoals(...pgoals: Array<GoalDefinition | Goal | Goals>): Goal[] {
    return _.flatten<Goal>(pgoals.map(g => {
        if (g instanceof Goal) {
            return g;
        } else if (isGoals(g)) {
            return g.goals;
        } else {
            return new Goal(g);
        }
    }));
}
