import type { Comment } from "../commentManager";

type CommentMarkerRef = Pick<Comment, "id" | "timestamp">;
type CommentBlockRef = Pick<Comment, "id" | "timestamp" | "selectedText">;

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMarkdownBlock(excerpt: string, body: string, commentId: string): string {
    const safeExcerpt = excerpt || "(no excerpt)";
    return `## ${safeExcerpt}\n<!-- side-note:${commentId} -->\n${body}\n\n---`;
}

export function resolveExistingMarker(content: string, comment: CommentMarkerRef): string | null {
    const idMarker = `<!-- side-note:${comment.id} -->`;
    if (content.includes(idMarker)) {
        return idMarker;
    }

    const legacyMarker = `<!-- side-note:${comment.timestamp} -->`;
    if (content.includes(legacyMarker)) {
        return legacyMarker;
    }

    return null;
}

export function replaceMarkdownCommentBlock(content: string, comment: CommentBlockRef, newBody: string): string {
    const marker = resolveExistingMarker(content, comment);
    if (!marker) {
        return content;
    }

    const escapedMarker = escapeRegex(marker);
    const blockRegex = new RegExp(`(^|\n)## .*?\n${escapedMarker}\n[^]*?(?=\n---\n|$)`, "m");
    if (!blockRegex.test(content)) {
        return content;
    }

    const replacement = buildMarkdownBlock(comment.selectedText, newBody, comment.id);
    return content.replace(blockRegex, replacement);
}

export function removeMarkdownCommentBlock(content: string, comment: CommentMarkerRef): string {
    const marker = resolveExistingMarker(content, comment);
    if (!marker) {
        return content;
    }

    const escapedMarker = escapeRegex(marker);
    const blockRegex = new RegExp(`(^|\n)## .*?\n${escapedMarker}\n[^]*?(?:\n---\n|$)`, "m");
    if (!blockRegex.test(content)) {
        return content;
    }

    const updated = content.replace(blockRegex, "").trim();
    return updated.length ? `${updated}\n` : "";
}
