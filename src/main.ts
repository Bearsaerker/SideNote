import { ItemView, WorkspaceLeaf, TFile, App, MarkdownView, Notice, ViewStateResult, Plugin, Modal, Setting, PluginSettingTab, editorLivePreviewField } from "obsidian";
import { Comment, CommentManager } from "./commentManager";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

interface CustomViewState extends Record<string, unknown> {
    filePath: string | null;
}

interface SideNoteSettings {
    commentSortOrder: "timestamp" | "position";
    showHighlights: boolean;
}

// Define a new interface for the entire plugin data
interface PluginData extends SideNoteSettings {
    comments: Comment[];
}

const DEFAULT_SETTINGS: SideNoteSettings = {
    commentSortOrder: "position",
    showHighlights: true,
};

class SideNoteView extends ItemView {
    private file: TFile | null = null;
    private plugin: SideNote;

    constructor(leaf: WorkspaceLeaf, plugin: SideNote, file: TFile | null = null) {
        super(leaf);
        this.plugin = plugin;
        this.file = file;
    }

    getViewType() {
        return "sidenote-view";
    }

    getDisplayText() {
        return "Side Note";
    }

    getIcon() {
        return "message-square";
    }

    async onOpen() {
        await Promise.resolve();
        // Set initial file to active file if not already set
        if (!this.file) {
            this.file = this.app.workspace.getActiveFile();
        }
        this.renderComments();
    }

    async setState(state: CustomViewState, result: ViewStateResult): Promise<void> {
        if (state.filePath) {
            const file = this.app.vault.getAbstractFileByPath(state.filePath);
            if (file instanceof TFile) {
                this.file = file;
                this.renderComments(); // render comments for the new file
            }
        }
        await super.setState(state, result);
    }

    /**
     * Update view to show comments for a specific file
     * Called when active file changes
     */
    public updateActiveFile(file: TFile | null) {
        this.file = file;
        this.renderComments();
    }

    public renderComments() { // Made public for settings tab to re-render
        this.containerEl.empty();
        this.containerEl.addClass("sidenote-view-container");
        if (this.file) {
            let commentsForFile = this.plugin.commentManager.getCommentsForFile(this.file.path);

            // Sort comments based on setting
            if (this.plugin.settings.commentSortOrder === "position") {
                commentsForFile.sort((a, b) => {
                    if (a.startLine === b.startLine) {
                        return a.startChar - b.startChar;
                    }
                    return a.startLine - b.startLine;
                });
            } else { // Default to timestamp
                commentsForFile.sort((a, b) => a.timestamp - b.timestamp);
            }

            if (commentsForFile.length > 0) {
                const commentsContainer = this.containerEl.createDiv("sidenote-comments-container");
                commentsForFile.forEach((comment) => {
                    const commentEl = commentsContainer.createDiv("sidenote-comment-item");

                    const headerEl = commentEl.createDiv("sidenote-comment-header");
                    const textInfoEl = headerEl.createDiv("sidenote-comment-text-info");
                    textInfoEl.createEl("h4", { text: comment.selectedText, cls: "sidenote-selected-text" });
                    textInfoEl.createEl("small", { text: new Date(comment.timestamp).toLocaleString(), cls: "sidenote-timestamp" });

                    const actionsEl = headerEl.createDiv("sidenote-comment-actions");

                    // Clicking the comment jumps to its location in the file
                    commentEl.onclick = async () => {
                        let targetLeaf: WorkspaceLeaf | null = null;
                        // Try to find an existing Markdown view for the file
                        this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
                            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === comment.filePath) {
                                targetLeaf = leaf;
                                return false; // Stop iteration
                            }
                        });

                        // If no existing view, open a new one.
                        if (!targetLeaf) {
                            const file = this.app.vault.getAbstractFileByPath(comment.filePath);
                            if (file instanceof TFile) {
                                const newLeaf = this.app.workspace.getLeaf(true);
                                await newLeaf.openFile(file);
                                targetLeaf = newLeaf;
                            }
                        }

                        if (targetLeaf && targetLeaf.view instanceof MarkdownView) {
                            this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
                            const editor = targetLeaf.view.editor;
                            const fileContent = editor.getValue();

                            // Use stored coordinates - they should already be updated by file change events
                            // If the coordinates are stale, they will be updated on next file modification
                            let startLine = comment.startLine;
                            let startChar = comment.startChar;
                            let endLine = comment.endLine;
                            let endChar = comment.endChar;

                            // Verify the text at stored coordinates matches (with hash verification if available)
                            const lines = fileContent.split('\n');
                            let textMatches = false;

                            if (startLine < lines.length) {
                                const line = lines[startLine];
                                const extractedText = line.substring(startChar, endChar);

                                // Check if hash matches (most reliable)
                                if (comment.selectedTextHash) {
                                    const crypto = require('crypto');
                                    const extractedHash = crypto.createHash('sha256').update(extractedText).digest('hex');
                                    textMatches = (extractedHash === comment.selectedTextHash);
                                } else {
                                    // Fallback to text comparison
                                    textMatches = (extractedText === comment.selectedText);
                                }
                            }

                            // If stored coordinates are invalid, try to find the text with hash verification
                            if (!textMatches) {
                                // Force update of comment coordinates
                                this.plugin.commentManager.updateCommentCoordinatesForFile(fileContent, comment.filePath);
                                await this.plugin.saveData();

                                // Use updated coordinates
                                startLine = comment.startLine;
                                startChar = comment.startChar;
                                endLine = comment.endLine;
                                endChar = comment.endChar;
                            }

                            // Set selection
                            editor.setSelection(
                                { line: startLine, ch: startChar },
                                { line: endLine, ch: endChar }
                            );

                            // Scroll to the selection
                            editor.scrollIntoView({
                                from: { line: startLine, ch: 0 },
                                to: { line: endLine, ch: 0 }
                            }, true);

                            editor.focus();
                        } else {
                            new Notice("Failed to jump to Markdown view.");
                        }
                    };

                    commentEl.createEl("p", { text: comment.comment, cls: "sidenote-comment-content" });

                    const editButton = actionsEl.createEl("button", { text: "Edit", cls: "sidenote-edit-button" });
                    editButton.onclick = (e) => {
                        e.stopPropagation(); // Prevent the comment item's click event
                        new CommentModal(this.app, (editedComment) => {
                            this.plugin.editComment(comment.timestamp, editedComment);
                        }, comment.comment).open();
                    };

                    const deleteButton = actionsEl.createEl("button", { text: "Delete", cls: "sidenote-delete-button" });
                    deleteButton.onclick = (e) => {
                        e.stopPropagation(); // Prevent the comment item's click event
                        this.plugin.deleteComment(comment.timestamp);
                    };
                });
            } else {
                const emptyStateEl = this.containerEl.createDiv("sidenote-empty-state");
                emptyStateEl.createEl("p", { text: "No comments for this file yet." });
                emptyStateEl.createEl("p", { text: "Select text in your note and use the 'add comment to selection' command to get started." });
            }
        } else {
            const emptyStateEl = this.containerEl.createDiv("sidenote-empty-state");
            emptyStateEl.createEl("p", { text: "No file selected." });
            emptyStateEl.createEl("p", { text: "Open a file to see its comments." });
        }
    }

    getState(): CustomViewState {
        return {
            filePath: this.file ? this.file.path : null,
        };
    }

    onunload() {
    }
}

// Function to switch views
async function switchToSideNoteView(app: App) {
    const activeFile = app.workspace.getActiveFile();

    if (!activeFile) {
        new Notice("No active Markdown file found.");
        return;
    }

    let leaf: WorkspaceLeaf | null = null;
    try {
        // Create a new leaf to the right in 'split' mode
        leaf = app.workspace.getLeaf('split', 'vertical');
    } catch (error) {
        new Notice("Failed to create a new split view for comments.");
        console.error("Error creating split leaf:", error);
        return;
    }

    if (leaf) {
        await leaf.setViewState({
            type: "sidenote-view",
            state: { filePath: activeFile.path }, // CustomViewState expects filePath
            active: true, // Make the new view active
        });
        void app.workspace.revealLeaf(leaf); // Ensure the new leaf is visible
    } else {
        new Notice("Failed to create or find a leaf for the comment view.");
    }
}

class CommentModal extends Modal {
    comment: string;
    onSubmit: (comment: string) => void;
    initialComment: string;

    constructor(app: App, onSubmit: (comment: string) => void, initialComment: string = '') {
        super(app);
        this.onSubmit = onSubmit;
        this.initialComment = initialComment;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("sidenote-comment-modal");

        contentEl.createEl("h2", { text: this.initialComment ? "Edit comment" : "Add comment" });

        const inputContainer = contentEl.createDiv("sidenote-comment-input-container");
        const input = inputContainer.createEl("textarea");
        input.placeholder = "Enter your comment...";
        input.value = this.initialComment;

        const footer = contentEl.createDiv("sidenote-modal-footer");
        const button = footer.createEl("button", {
            text: this.initialComment ? "Save" : "Add",
            cls: "mod-cta"
        });
        button.onclick = () => {
            this.comment = input.value;
            this.onSubmit(this.comment);
            this.close();
        };

        input.focus();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class SideNoteSettingTab extends PluginSettingTab {
    plugin: SideNote;

    constructor(app: App, plugin: SideNote) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Comment sort order")
            .setDesc("Choose how comments are sorted in the custom view.")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("timestamp", "By timestamp")
                    .addOption("position", "By position in file")
                    .setValue(this.plugin.settings.commentSortOrder)
                    .onChange(async (value: "timestamp" | "position") => {
                        this.plugin.settings.commentSortOrder = value;
                        await this.plugin.saveData(); // Save all plugin data
                        // Re-render the custom view if it's open to apply the new sort order
                        this.app.workspace.getLeavesOfType("sidenote-view").forEach(leaf => {
                            if (leaf.view instanceof SideNoteView) {
                                leaf.view.renderComments();
                            }
                        });
                    })
            );

        new Setting(containerEl)
            .setName("Show highlights in editor")
            .setDesc("Display highlights for commented text in the editor. After changing this setting, please restart Obsidian to see the effect.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showHighlights)
                    .onChange(async (value: boolean) => {
                        this.plugin.settings.showHighlights = value;
                        await this.plugin.saveData();
                        // Refresh editor decorations
                        this.plugin.refreshEditorDecorations();
                    })
            );

        // Orphaned comments management section
        const orphanedCount = this.plugin.commentManager.getOrphanedCommentCount();

        new Setting(containerEl)
            .setName("Orphaned comments")
            .setDesc(`There are ${orphanedCount} orphaned comment(s). These are comments whose original text was deleted.`);

        new Setting(containerEl)
            .addButton((button) =>
                button
                    .setButtonText(`Delete ${orphanedCount} orphaned comment(s)`)
                    .setWarning()
                    .onClick(async () => {
                        const deleted = this.plugin.commentManager.deleteOrphanedComments();
                        await this.plugin.saveData();
                        // Re-render views
                        this.app.workspace.getLeavesOfType("sidenote-view").forEach(leaf => {
                            if (leaf.view instanceof SideNoteView) {
                                leaf.view.renderComments();
                            }
                        });
                        new Notice(`Deleted ${deleted} orphaned comment(s)!`);
                        // Refresh the settings display
                        this.display();
                    })
                    .setDisabled(orphanedCount === 0)
            );
    }
}

// Main plugin class
export default class SideNote extends Plugin {
    commentManager: CommentManager;
    settings: SideNoteSettings;
    comments: Comment[] = [];

    async onload() {
        await this.loadPluginData(); // Load all data
        this.commentManager = new CommentManager(this.comments);

        // Migrate existing comments: add missing hashes and initialize isOrphaned flag
        await this.migrateComments();

        // Register editor extensions for highlighting comments
        this.registerEditorExtension([this.createHighlightPlugin()]);

        this.addSettingTab(new SideNoteSettingTab(this.app, this));

        this.registerView("sidenote-view", (leaf) => new SideNoteView(leaf, this));

        this.addCommand({
            id: "open-comment-view",
            name: "Open in Split View",
            callback: () => {
                void switchToSideNoteView(this.app);
            },
        });

        this.addCommand({
            id: "activate-view",
            name: "Open in Sidebar",
            callback: () => {
                this.activateView();
            },
        });

        this.addCommand({
            id: "add-comment-to-selection",
            name: "Add comment to selection",
            callback: () => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) {
                    const editor = activeView.editor;
                    const selection = editor.getSelection();
                    const cursorStart = editor.getCursor("from");
                    const cursorEnd = editor.getCursor("to");
                    const filePath = activeView.file?.path;

                    if (selection && filePath) {
                        new CommentModal(this.app, (comment) => {
                            const crypto = require('crypto');
                            const newComment: Comment = {
                                filePath: filePath,
                                startLine: cursorStart.line,
                                startChar: cursorStart.ch,
                                endLine: cursorEnd.line,
                                endChar: cursorEnd.ch,
                                selectedText: selection,
                                selectedTextHash: crypto.createHash('sha256').update(selection).digest('hex'),
                                comment: comment,
                                timestamp: Date.now(),
                                isOrphaned: false,
                            };
                            this.addComment(newComment);
                        }).open();
                    } else {
                        new Notice("No text selected or file not found.");
                    }
                } else {
                    new Notice("No active Markdown view found.");
                }
            },
        });

        // Add context menu item to editor
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                //  Only add the menu item if there is a selection
                if (editor.somethingSelected()) {
                    menu.addItem((item) => {
                        item.setTitle("Add comment to selection")
                            .setIcon("message-square")
                            .onClick(() => {
                                const selection = editor.getSelection();
                                const cursorStart = editor.getCursor("from");
                                const cursorEnd = editor.getCursor("to");
                                const filePath = view.file?.path;

                                if (selection && filePath) {
                                    new CommentModal(this.app, (comment) => {
                                        const crypto = require('crypto');
                                        const newComment: Comment = {
                                            filePath: filePath,
                                            startLine: cursorStart.line,
                                            startChar: cursorStart.ch,
                                            endLine: cursorEnd.line,
                                            endChar: cursorEnd.ch,
                                            selectedText: selection,
                                            selectedTextHash: crypto.createHash('sha256').update(selection).digest('hex'),
                                            comment: comment,
                                            timestamp: Date.now(),
                                            isOrphaned: false,
                                        };
                                        this.addComment(newComment);
                                    }).open();
                                } else {
                                    new Notice("No text selected or file not found.");
                                }
                            });
                    });
                }
            })
        );

        // Add ribbon icon to open Side Note in sidebar
        this.addRibbonIcon("message-square", "Side Note: Open in Sidebar", () => {
            this.activateView();
        });

        // Listen for active leaf changes to update the comment view
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                if (leaf && leaf.view instanceof MarkdownView) {
                    const file = leaf.view.file;
                    // Update all SideNoteView instances
                    this.app.workspace.getLeavesOfType("sidenote-view").forEach(sideNoteLeaf => {
                        if (sideNoteLeaf.view instanceof SideNoteView) {
                            sideNoteLeaf.view.updateActiveFile(file);
                        }
                    });
                }
            })
        );

        // Update comment paths when files are renamed
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (file instanceof TFile) {
                    this.commentManager.renameFile(oldPath, file.path);
                    void this.saveData();
                    // Update views
                    this.app.workspace.getLeavesOfType("sidenote-view").forEach(leaf => {
                        if (leaf.view instanceof SideNoteView) {
                            leaf.view.renderComments();
                        }
                    });
                }
            })
        );

        // Update comments when files are modified
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                // Handle data.json updates
                if (file.path === '.obsidian/plugins/side-note/data.json' ||
                    (file instanceof TFile && file.name === 'data.json' && file.parent?.name === 'side-note')) {
                    try {
                        await this.loadPluginData();
                        this.commentManager.updateComments(this.comments);
                        // Re-render views
                        this.app.workspace.getLeavesOfType("sidenote-view").forEach(leaf => {
                            if (leaf.view instanceof SideNoteView) {
                                leaf.view.renderComments();
                            }
                        });
                    } catch (error) {
                        console.error("Error reloading plugin data:", error);
                    }
                }
                // Update comment coordinates when Markdown files are modified
                else if (file instanceof TFile && file.extension === 'md') {
                    try {
                        const fileContent = await this.app.vault.read(file);
                        this.commentManager.updateCommentCoordinatesForFile(fileContent, file.path);
                        await this.saveData();
                        // Re-render views if any comments were updated
                        this.app.workspace.getLeavesOfType("sidenote-view").forEach(leaf => {
                            if (leaf.view instanceof SideNoteView) {
                                leaf.view.renderComments();
                            }
                        });
                    } catch (error) {
                        console.error("Error updating comment coordinates:", error);
                    }
                }
            })
        );
    }

    /**
     * Activate the Side Note view - open it in the right sidebar if not already open
     */
    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType("sidenote-view");

        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
        } else {
            // Our view could not be found in the workspace, create a new leaf in the right sidebar
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                leaf = rightLeaf;
                await leaf.setViewState({ type: "sidenote-view", active: true });
            }
        }

        // Reveal the leaf in case it's in a collapsed sidebar
        if (leaf) {
            workspace.revealLeaf(leaf);
            // Update to show comments for the current active file
            if (leaf.view instanceof SideNoteView) {
                const activeFile = workspace.getActiveFile();
                leaf.view.updateActiveFile(activeFile);
            }
        }
    }

    async onCommentsChanged(message: string) {
        await this.saveData();
        this.app.workspace.getLeavesOfType("sidenote-view").forEach(leaf => {
            if (leaf.view instanceof SideNoteView) {
                leaf.view.renderComments();
            }
        });
        new Notice(message);
    }

    addComment(newComment: Comment) {
        this.commentManager.addComment(newComment);
        void this.onCommentsChanged("Comment added!");
    }

    editComment(timestamp: number, newCommentText: string) {
        this.commentManager.editComment(timestamp, newCommentText);
        void this.onCommentsChanged("Comment updated!");
    }

    deleteComment(timestamp: number) {
        this.commentManager.deleteComment(timestamp);
        void this.onCommentsChanged("Comment deleted!");
    }

    async loadPluginData() {
        const loadedData: PluginData = Object.assign({}, { comments: [] }, DEFAULT_SETTINGS, await this.loadData());
        this.settings = {
            commentSortOrder: loadedData.commentSortOrder || DEFAULT_SETTINGS.commentSortOrder,
            showHighlights: loadedData.showHighlights !== undefined ? loadedData.showHighlights : DEFAULT_SETTINGS.showHighlights,
        };
        this.comments = loadedData.comments || [];
    }

    /**
     * Migrate existing comments to add missing hashes and initialize flags
     */
    async migrateComments() {
        let needsSave = false;

        this.comments.forEach(comment => {
            // Add missing selectedTextHash
            if (!comment.selectedTextHash && comment.selectedText) {
                const crypto = require('crypto');
                comment.selectedTextHash = crypto.createHash('sha256').update(comment.selectedText).digest('hex');
                needsSave = true;
            }

            // Initialize isOrphaned flag if not present
            if (comment.isOrphaned === undefined) {
                comment.isOrphaned = false;
                needsSave = true;
            }
        });

        if (needsSave) {
            await this.saveData();
            console.log("Migrated comments: added hashes and initialized flags");
        }
    }

    async saveData() {
        const dataToSave: PluginData = {
            ...this.settings,
            comments: this.comments,
        };
        await super.saveData(dataToSave);
        // Refresh editor decorations when data changes
        this.refreshEditorDecorations();
    }

    /**
     * Refresh editor decorations for all open markdown views
     */
    refreshEditorDecorations() {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView) {
                const editor = leaf.view.editor;
                // Force editor to refresh by triggering a state update
                if (editor && (editor as any).cm) {
                    const cm = (editor as any).cm;
                    if (cm.dispatch) {
                        cm.dispatch({ effects: [] });
                    }
                }
            }
        });
    }

    /**
     * Create ViewPlugin for highlighting comments in editor
     */
    private createHighlightPlugin() {
        const plugin = this;
        return ViewPlugin.fromClass(class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = this.buildDecorations(view);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = this.buildDecorations(update.view);
                }
            }

            buildDecorations(view: EditorView): DecorationSet {
                const builder = new RangeSetBuilder<Decoration>();

                // Check if highlights are enabled
                if (!plugin.settings.showHighlights) {
                    return builder.finish();
                }

                const file = plugin.app.workspace.getActiveFile();

                if (!file) return builder.finish();

                const comments = plugin.commentManager.getCommentsForFile(file.path);
                const doc = view.state.doc;
                const decorationsArray: Array<{from: number, to: number, decoration: Decoration}> = [];

                comments.forEach(comment => {
                    try {
                        if (comment.isOrphaned) {
                            // For orphaned comments, highlight one character after the original position
                            const line = doc.line(comment.startLine + 1); // CodeMirror uses 1-based line numbers
                            const from = line.from + comment.startChar;
                            // Highlight one character (or end of line if at the end)
                            const to = Math.min(from + 1, line.to);

                            if (from >= 0 && to <= doc.length && from < to) {
                                decorationsArray.push({
                                    from,
                                    to,
                                    decoration: Decoration.mark({
                                        class: 'sidenote-highlight orphaned',
                                        attributes: {
                                            'data-comment-timestamp': comment.timestamp.toString()
                                        }
                                    })
                                });
                            }
                        } else {
                            // For non-orphaned comments, highlight the original text
                            const line = doc.line(comment.startLine + 1);
                            const from = line.from + comment.startChar;
                            const to = line.from + comment.endChar;

                            if (from >= 0 && to <= doc.length && from < to) {
                                decorationsArray.push({
                                    from,
                                    to,
                                    decoration: Decoration.mark({
                                        class: 'sidenote-highlight',
                                        attributes: {
                                            'data-comment-timestamp': comment.timestamp.toString()
                                        }
                                    })
                                });
                            }
                        }
                    } catch (e) {
                        // Line might not exist, skip this comment
                        console.warn('Failed to create decoration for comment:', e);
                    }
                });

                // Sort by position and add to builder
                decorationsArray.sort((a, b) => a.from - b.from);
                decorationsArray.forEach(({ from, to, decoration }) => {
                    builder.add(from, to, decoration);
                });

                return builder.finish();
            }
        }, {
            decorations: (v: any) => v.decorations
        });
    }
}
