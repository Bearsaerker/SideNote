import { createHash } from 'crypto';

export interface Comment {
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    comment: string;
    timestamp: number;
    isOrphaned?: boolean;
    commentPath?: string; // Path to markdown-stored comment (optional)
}

export class CommentManager {
    private comments: Comment[];
    private readonly MIN_TEXT_LENGTH = 3; // Minimum characters to create regex pattern

    constructor(comments: Comment[]) {
        this.comments = comments;
    }

    /**
     * Generate SHA256 hash of the selected text
     * @param text The text to hash
     * @returns The hash string
     */
    private generateHash(text: string): string {
        return createHash('sha256').update(text).digest('hex');
    }

    getCommentsForFile(filePath: string): Comment[] {
        return this.comments.filter(comment => comment.filePath === filePath);
    }

    addComment(newComment: Comment) {
        // Generate hash if not present
        if (!newComment.selectedTextHash) {
            newComment.selectedTextHash = this.generateHash(newComment.selectedText);
        }
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

    /**
     * Delete all orphaned comments
     * @returns The number of orphaned comments deleted
     */
    deleteOrphanedComments(): number {
        const initialLength = this.comments.length;
        // Filter in-place to maintain reference
        for (let i = this.comments.length - 1; i >= 0; i--) {
            if (this.comments[i].isOrphaned) {
                this.comments.splice(i, 1);
            }
        }
        return initialLength - this.comments.length;
    }

    /**
     * Get all orphaned comments
     * @returns Array of orphaned comments
     */
    getOrphanedComments(): Comment[] {
        return this.comments.filter(comment => comment.isOrphaned);
    }

    /**
     * Get the count of orphaned comments
     * @returns Number of orphaned comments
     */
    getOrphanedCommentCount(): number {
        return this.comments.filter(comment => comment.isOrphaned).length;
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
     * Calculate distance between two positions (for finding closest match)
     * @param line1 First line number
     * @param char1 First character position
     * @param line2 Second line number
     * @param char2 Second character position
     * @returns Distance score (lower is closer)
     */
    private calculateDistance(line1: number, char1: number, line2: number, char2: number): number {
        // Weight line distance more heavily than character distance
        const lineDistance = Math.abs(line1 - line2);
        const charDistance = Math.abs(char1 - char2);
        return lineDistance * 1000 + charDistance;
    }

    /**
     * Find text position with hash verification for accuracy
     * Strategy 1: Search around hint coordinates and verify hash match
     * When multiple matches exist, returns the one closest to the hint coordinates
     * @param fileContent The current file content
     * @param selectedText The text to find
     * @param selectedTextHash The hash of the selected text
     * @param hintStartLine Starting line as a hint
     * @param hintStartChar Starting character as a hint
     * @param hintEndLine Ending line as a hint
     * @returns Object with line, startChar, endChar or null if not found
     */
    private findTextPositionWithHashVerification(fileContent: string, selectedText: string, selectedTextHash: string, hintStartLine: number, hintStartChar: number, hintEndLine: number): { line: number; startChar: number; endChar: number } | null {
        if (!selectedText || selectedText.length < this.MIN_TEXT_LENGTH) {
            return null;
        }

        const lines = fileContent.split('\n');
        const escapedText = selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedText, 'g'); // Use global flag to find all matches

        // Search within a range around the hint (±10 lines for flexibility)
        const startLine = Math.max(0, hintStartLine - 10);
        const endLine = Math.min(lines.length, hintEndLine + 10);

        let candidates: { line: number; startChar: number; endChar: number; distance: number }[] = [];

        // Search through the hint range and collect all matching candidates
        for (let lineNum = startLine; lineNum < endLine; lineNum++) {
            let match;
            regex.lastIndex = 0; // Reset regex state
            while ((match = regex.exec(lines[lineNum])) !== null) {
                const foundText = lines[lineNum].substring(match.index, match.index + selectedText.length);
                // Verify hash matches to ensure correct text
                if (this.generateHash(foundText) === selectedTextHash) {
                    const distance = this.calculateDistance(lineNum, match.index, hintStartLine, hintStartChar);
                    candidates.push({
                        line: lineNum,
                        startChar: match.index,
                        endChar: match.index + selectedText.length,
                        distance: distance
                    });
                }
            }
        }

        // Return the candidate closest to the hint coordinates
        if (candidates.length > 0) {
            candidates.sort((a, b) => a.distance - b.distance);
            const closest = candidates[0];
            return {
                line: closest.line,
                startChar: closest.startChar,
                endChar: closest.endChar
            };
        }

        return null;
    }

    /**
     * Find text by hash across the entire file
     * Strategy 2: Search entire file for matching hash using optimized approach
     * When multiple matches exist, returns the one closest to the hint coordinates
     * @param fileContent The current file content
     * @param selectedTextHash The hash to match
     * @param originalTextLength The length of the original selected text (optimization hint)
     * @param hintStartLine Starting line hint for proximity scoring
     * @param hintStartChar Starting character hint for proximity scoring
     * @returns Object with line, startChar, endChar, text or null if not found
     */
    private findTextByHashOptimized(fileContent: string, selectedTextHash: string, originalTextLength: number, hintStartLine?: number, hintStartChar?: number): { line: number; startChar: number; endChar: number; text: string } | null {
        const lines = fileContent.split('\n');
        let candidates: { line: number; startChar: number; endChar: number; text: string; distance: number }[] = [];

        // Search entire file for text with matching hash
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // First, try exact length match (most common case)
            if (line.length >= originalTextLength) {
                for (let startChar = 0; startChar <= line.length - originalTextLength; startChar++) {
                    const candidate = line.substring(startChar, startChar + originalTextLength);
                    if (this.generateHash(candidate) === selectedTextHash) {
                        const distance = (hintStartLine !== undefined && hintStartChar !== undefined)
                            ? this.calculateDistance(lineNum, startChar, hintStartLine, hintStartChar)
                            : 0;
                        candidates.push({
                            line: lineNum,
                            startChar: startChar,
                            endChar: startChar + originalTextLength,
                            text: candidate,
                            distance: distance
                        });
                    }
                }
            }

            // If not found with exact length, try nearby lengths (±20% tolerance for edge cases)
            const minLength = Math.max(this.MIN_TEXT_LENGTH, Math.floor(originalTextLength * 0.8));
            const maxLength = Math.min(line.length, Math.ceil(originalTextLength * 1.2));

            for (let length = minLength; length <= maxLength; length++) {
                if (length === originalTextLength) continue; // Already checked

                for (let startChar = 0; startChar <= line.length - length; startChar++) {
                    const candidate = line.substring(startChar, startChar + length);
                    if (this.generateHash(candidate) === selectedTextHash) {
                        const distance = (hintStartLine !== undefined && hintStartChar !== undefined)
                            ? this.calculateDistance(lineNum, startChar, hintStartLine, hintStartChar)
                            : 0;
                        candidates.push({
                            line: lineNum,
                            startChar: startChar,
                            endChar: startChar + length,
                            text: candidate,
                            distance: distance
                        });
                    }
                }
            }
        }

        // Return the candidate closest to the hint coordinates
        if (candidates.length > 0) {
            candidates.sort((a, b) => a.distance - b.distance);
            const closest = candidates[0];
            return {
                line: closest.line,
                startChar: closest.startChar,
                endChar: closest.endChar,
                text: closest.text
            };
        }

        return null;
    }

    /**
     * Find the position of selected text in the current file content
     * Uses regex matching as a fallback to line-based positioning
     * When multiple matches exist, returns the one closest to hint coordinates
     * @param fileContent The current file content
     * @param selectedText The text to find
     * @param hintStartLine Optional starting line as a hint (performance optimization)
     * @param hintEndLine Optional ending line as a hint (performance optimization)
     * @param hintStartChar Optional starting character as a hint (performance optimization)
     * @returns Object with line, startChar, endChar or null if not found
     */
    findTextPosition(fileContent: string, selectedText: string, hintStartLine?: number, hintEndLine?: number, hintStartChar?: number): { line: number; startChar: number; endChar: number } | null {
        if (!selectedText || selectedText.length < this.MIN_TEXT_LENGTH) {
            return null;
        }

        const lines = fileContent.split('\n');

        // Escape special regex characters
        const escapedText = selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Create a regex that matches the text (case-sensitive) with global flag
        const regex = new RegExp(escapedText, 'g');

        let candidates: { line: number; startChar: number; endChar: number; distance: number }[] = [];

        // Determine search range - prioritize hint range if provided
        let startLine = 0;
        let endLine = lines.length;

        if (hintStartLine !== undefined && hintEndLine !== undefined) {
            // Search within a range around the hint (±10 lines for flexibility)
            startLine = Math.max(0, hintStartLine - 10);
            endLine = Math.min(lines.length, hintEndLine + 10);
        }

        // Search through the content and collect all matches
        for (let lineNum = startLine; lineNum < endLine; lineNum++) {
            let match;
            regex.lastIndex = 0; // Reset regex state
            while ((match = regex.exec(lines[lineNum])) !== null) {
                const distance = (hintStartLine !== undefined && hintStartChar !== undefined)
                    ? this.calculateDistance(lineNum, match.index, hintStartLine, hintStartChar)
                    : 0;
                candidates.push({
                    line: lineNum,
                    startChar: match.index,
                    endChar: match.index + selectedText.length,
                    distance: distance
                });
            }
        }

        // If found in hint range, return the closest match
        if (candidates.length > 0) {
            candidates.sort((a, b) => a.distance - b.distance);
            const closest = candidates[0];
            return {
                line: closest.line,
                startChar: closest.startChar,
                endChar: closest.endChar
            };
        }

        // If not found in hint range, search entire file
        if (hintStartLine !== undefined && hintEndLine !== undefined) {
            candidates = [];
            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                let match;
                regex.lastIndex = 0;
                while ((match = regex.exec(lines[lineNum])) !== null) {
                    const distance = (hintStartLine !== undefined && hintStartChar !== undefined)
                        ? this.calculateDistance(lineNum, match.index, hintStartLine, hintStartChar)
                        : 0;
                    candidates.push({
                        line: lineNum,
                        startChar: match.index,
                        endChar: match.index + selectedText.length,
                        distance: distance
                    });
                }
            }

            if (candidates.length > 0) {
                candidates.sort((a, b) => a.distance - b.distance);
                const closest = candidates[0];
                return {
                    line: closest.line,
                    startChar: closest.startChar,
                    endChar: closest.endChar
                };
            }
        }

        return null;
    }

    /**
     * Update comment coordinates based on file content changes
     * Uses 3-stage hash-based matching strategy:
     * 1. Search near old coordinates with hash verification
     * 2. Search entire file by hash
     * 3. Mark as orphaned if not found
     * @param fileContent The current file content
     * @param filePath The path of the file that was changed
     */
    updateCommentCoordinatesForFile(fileContent: string, filePath: string): void {
        const fileComments = this.comments.filter(comment => comment.filePath === filePath);

        fileComments.forEach(comment => {
            // Skip if already marked as orphaned
            if (comment.isOrphaned) {
                return;
            }

            let newPosition: { line: number; startChar: number; endChar: number } | null = null;

            // Stage 1: Search near old coordinates with hash verification
            if (comment.selectedTextHash) {
                newPosition = this.findTextPositionWithHashVerification(
                    fileContent,
                    comment.selectedText,
                    comment.selectedTextHash,
                    comment.startLine,
                    comment.startChar,
                    comment.endLine
                );
            }

            // Stage 2: Search entire file by hash if not found in Stage 1
            if (!newPosition && comment.selectedTextHash && comment.selectedText) {
                const hashMatch = this.findTextByHashOptimized(
                    fileContent,
                    comment.selectedTextHash,
                    comment.selectedText.length,
                    comment.startLine,
                    comment.startChar
                );
                if (hashMatch) {
                    newPosition = hashMatch;
                    // Update selectedText in case it was modified
                    comment.selectedText = hashMatch.text;
                }
            }

            // Stage 3: Fall back to regex search without hash (only for legacy comments without hash)
            // Do NOT use this stage if hash exists but doesn't match - that means text was deleted
            if (!newPosition && !comment.selectedTextHash) {
                newPosition = this.findTextPosition(
                    fileContent,
                    comment.selectedText,
                    comment.startLine,
                    comment.endLine,
                    comment.startChar
                );
            }

            // Update or mark as orphaned
            if (newPosition) {
                comment.startLine = newPosition.line;
                comment.startChar = newPosition.startChar;
                comment.endLine = newPosition.line;
                comment.endChar = newPosition.endChar;
            } else {
                comment.isOrphaned = true;
            }
        });
    }
}
