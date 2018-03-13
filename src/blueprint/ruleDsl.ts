import { GoalSetter, PushTest } from "../common/listener/GoalSetter";
import { GuardedGoalSetter } from "../common/listener/support/GuardedGoalSetter";
import { allSatisfied } from "../common/listener/support/pushTestUtils";
import { Builder } from "../spi/build/Builder";

export class PushRule {

    public goalSetter: GoalSetter;

    public builder: Builder;

    public readonly pushTest: PushTest;

    constructor(private guard1: PushTest, private guards: PushTest[]) {
        this.pushTest = allSatisfied(guard1, ...guards);
    }

    public setGoals(goals): this {
        this.goalSetter = new GuardedGoalSetter(goals, this.guard1, ...this.guards);
        return this;
    }

    public buildWith(builder: Builder): PushRule {
        this.builder = builder;
        return this;
    }

}

/**
 * Simple GoalSetter DSL
 * @param {PushTest} guard1
 * @param {PushTest} guards
 */
export function whenPushSatisfies(guard1: PushTest, ...guards: PushTest[]): PushRule {
    return new PushRule(guard1, guards);
}

export const onAnyPush: PushRule = new PushRule(() => true, []);
