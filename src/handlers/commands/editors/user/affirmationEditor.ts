import { HandleCommand } from "@atomist/automation-client";
import { BranchCommit } from "@atomist/automation-client/operations/edit/editModes";
import { editorHandler } from "@atomist/automation-client/operations/edit/editorToCommand";
import { SimpleProjectEditor } from "@atomist/automation-client/operations/edit/projectEditor";
import { doWithFiles } from "@atomist/automation-client/project/util/projectUtils";
import { editor } from "../registerEditor";
import { EditOneOrAllParameters } from "../toclient/EditOneOrAllParameters";

export const affirmationEditor: HandleCommand<any> = editor(
    () => appendAffirmationToReadMe,
    "affirmation",
    {
        editMode: { message: `Everyone needs encouragement sometimes`, branch: "master"} as BranchCommit,
    },
);

const affirmations = [
    "You're good enough, you're smart enough, and doggone it, people like you.",
    "I believe in you. You can do the thing!",
    "You are the delta in what you do, not the things you did in the past",
    "It’s only a thought, and a thought can be changed.",
    "As I say yes to life, life says yes to me.",
    "Deep at the center of my being is an infinite well of love.",
    "I come from the loving space of my heart, and I know that love opens all doors.",
]

function randomAffirmation() {
    return affirmations[getRandomInt(affirmations.length)];
}

function getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}

export const appendAffirmationToReadMe: SimpleProjectEditor = (p, ctx, params) => {
    const affirmation = randomAffirmation();
    return ctx.messageClient.respond("Adding to README: " + affirmation)
        .then(() => doWithFiles(p, "README.md", f =>
            f.getContent().then(content =>
                f.setContent(`${content}\n${affirmation}\n`))));
};
