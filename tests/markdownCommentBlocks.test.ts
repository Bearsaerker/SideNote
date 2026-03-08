import * as assert from "node:assert/strict";
import test from "node:test";
import { buildMarkdownBlock, removeMarkdownCommentBlock, replaceMarkdownCommentBlock } from "../src/core/markdownCommentBlocks";

test("replaceMarkdownCommentBlock updates only targeted id block", () => {
    const commentA = { id: "id-a", timestamp: 1710000000000, selectedText: "Excerpt A" };
    const commentB = { id: "id-b", timestamp: 1710000000000, selectedText: "Excerpt B" };

    const content = [
        "# Side Notes for note.md",
        "",
        buildMarkdownBlock(commentA.selectedText, "Body A", commentA.id),
        "",
        buildMarkdownBlock(commentB.selectedText, "Body B", commentB.id),
        "",
    ].join("\n");

    const updated = replaceMarkdownCommentBlock(content, commentB, "Body B updated");

    assert.equal(updated.includes("Body A"), true);
    assert.equal(updated.includes("Body B updated"), true);
    assert.equal(updated.includes(`<!-- side-note:${commentA.id} -->`), true);
    assert.equal(updated.includes(`<!-- side-note:${commentB.id} -->`), true);
});

test("replaceMarkdownCommentBlock falls back to legacy timestamp marker", () => {
    const comment = { id: "id-new", timestamp: 1711111111111, selectedText: "Legacy excerpt" };
    const content = [
        "# Side Notes for note.md",
        "",
        "## Legacy excerpt",
        `<!-- side-note:${comment.timestamp} -->`,
        "Old body",
        "",
        "---",
        "",
    ].join("\n");

    const updated = replaceMarkdownCommentBlock(content, comment, "New body");

    assert.equal(updated.includes(`<!-- side-note:${comment.id} -->`), true);
    assert.equal(updated.includes(`<!-- side-note:${comment.timestamp} -->`), false);
    assert.equal(updated.includes("New body"), true);
});

test("removeMarkdownCommentBlock deletes only targeted id block", () => {
    const commentA = { id: "id-a", timestamp: 1710000000000, selectedText: "Excerpt A" };
    const commentB = { id: "id-b", timestamp: 1710000000000, selectedText: "Excerpt B" };

    const content = [
        "# Side Notes for note.md",
        "",
        buildMarkdownBlock(commentA.selectedText, "Body A", commentA.id),
        "",
        buildMarkdownBlock(commentB.selectedText, "Body B", commentB.id),
        "",
    ].join("\n");

    const updated = removeMarkdownCommentBlock(content, commentA);

    assert.equal(updated.includes(`<!-- side-note:${commentA.id} -->`), false);
    assert.equal(updated.includes(`<!-- side-note:${commentB.id} -->`), true);
    assert.equal(updated.includes("Body A"), false);
    assert.equal(updated.includes("Body B"), true);
});
