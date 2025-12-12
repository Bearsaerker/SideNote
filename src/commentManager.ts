export interface Comment {
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    comment: string;
    timestamp: number;
}

export class CommentManager {
    private comments: Comment[];
    private readonly MIN_TEXT_LENGTH = 3; // Minimum characters to create regex pattern

    constructor(comments: Comment[]) {
        this.comments = comments;
    }

    getCommentsForFile(filePath: string): Comment[] {
        return this.comments.filter(comment => comment.filePath === filePath);
    }

    addComment(newComment: Comment) {
        this.comments.push(newComment);
    }

    editComment(timestamp: number, newCommentText: string) {
        const commentToEdit = this.comments.find(comment => comment.timestamp === timestamp);
        if (commentToEdit) {
            commentToEdit.comment = newCommentText;
        }
    }

    deleteComment(timestamp: number) {
        const indexToDelete = this.comments.findIndex(comment => comment.timestamp === timestamp);
        if (indexToDelete > -1) {
            this.comments.splice(indexToDelete, 1);
        }
    }

    renameFile(oldPath: string, newPath: string) {
        this.comments.forEach(comment => {
            if (comment.filePath === oldPath) {
                comment.filePath = newPath;
            }
        });
    }

    updateComments(newComments: Comment[]) {
        this.comments = newComments;
    }

    getComments(): Comment[] {
        return this.comments;
    }

    /**
     * Find the position of selected text in the current file content
     * Uses regex matching as a fallback to line-based positioning
     * @param fileContent The current file content
     * @param selectedText The text to find
     * @returns Object with line, startChar, endChar or null if not found
     */
    findTextPosition(fileContent: string, selectedText: string): { line: number; startChar: number; endChar: number } | null {
        if (!selectedText || selectedText.length < this.MIN_TEXT_LENGTH) {
            return null;
        }

        const lines = fileContent.split('\n');

        // Escape special regex characters
        const escapedText = selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Create a regex that matches the text (case-sensitive)
        const regex = new RegExp(escapedText);

        // Search through the content
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const match = regex.exec(lines[lineNum]);
            if (match) {
                return {
                    line: lineNum,
                    startChar: match.index,
                    endChar: match.index + selectedText.length
                };
            }
        }

        return null;
    }
}
