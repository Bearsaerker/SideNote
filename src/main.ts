import { ItemView, WorkspaceLeaf, TFile, App, MarkdownView, Notice, ViewStateResult, Plugin, Modal, Setting, PluginSettingTab, editorLivePreviewField, MarkdownRenderer } from "obsidian";
import { Comment, CommentManager } from "./commentManager";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { buildMarkdownBlock as buildCommentMarkdownBlock, removeMarkdownCommentBlock, replaceMarkdownCommentBlock } from "./core/markdownCommentBlocks";
import { bindModalActionHandlers } from "./core/modalActionBindings";
import { SubmitExecutionGuard } from "./core/submitExecutionGuard";

// Helper function to generate SHA256 hash using Web Crypto API (works on mobile)
async function generateHash(text: string): Promise<string> {
    try {
        // Try Web Crypto API first (works on mobile)
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    } catch (error) {
        // Fallback to Node.js crypto for desktop
        try {
            const nodeCrypto = require('crypto');
            return nodeCrypto.createHash('sha256').update(text).digest('hex');
        } catch {
            // If all fails, return a simple hash
            new Notice("Warning: Could not generate proper hash, using fallback");
            let hash = 0;
            for (let i = 0; i < text.length; i++) {
                const char = text.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return Math.abs(hash).toString(16);
        }
    }
}

function generateCommentId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    try {
        const nodeCrypto = require('crypto');
        if (typeof nodeCrypto.randomUUID === "function") {
            return nodeCrypto.randomUUID();
        }
    } catch {
        // ignore and use fallback below
    }
    return `sn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Define a state effect to trigger decoration updates
const forceUpdateEffect = StateEffect.define<null>();

interface CustomViewState extends Record<string, unknown> {
    filePath: string | null;
}

interface SideNoteSettings {
    commentSortOrder: "timestamp" | "position";
    showHighlights: boolean;
    markdownFolder: string;
    highlightColor: string;
    highlightOpacity: number;
    showResolvedComments: boolean; // Show resolved comments dimmed in the sidebar
}

// Define a new interface for the entire plugin data
interface PluginData extends SideNoteSettings {
    comments: Comment[];
}

const DEFAULT_SETTINGS: SideNoteSettings = {
    commentSortOrder: "position",
    showHighlights: true,
    markdownFolder: "side-note-comments",
    highlightColor: "#FFC800",
    highlightOpacity: 0.2,
    showResolvedComments: false,
};

class SideNoteView extends ItemView {
    private file: TFile | null = null;
    private plugin: SideNote;
    private activeCommentId: string | null = null;
    private showAllNotes = false;

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

    /**
     * Highlight and scroll to a specific comment
     */
    public highlightComment(commentId: string) {
        this.activeCommentId = commentId;
        this.renderComments();
        // Scroll to the highlighted comment
        setTimeout(() => {
            const commentEl = this.containerEl.querySelector(`[data-comment-id="${commentId}"]`);
            if (commentEl) {
                commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    public setShowAllNotes(value: boolean) {
        this.showAllNotes = value;
        this.renderComments();
    }

    private renderCommentItem(container: HTMLElement, comment: Comment) {
        const commentEl = container.createDiv("sidenote-comment-item");
        commentEl.setAttribute("data-comment-id", comment.id);

        if (comment.resolved) {
            commentEl.addClass("resolved");
        }

        if (this.activeCommentId === comment.id) {
            commentEl.addClass("active");
        }

        const headerEl = commentEl.createDiv("sidenote-comment-header");
        const textInfoEl = headerEl.createDiv("sidenote-comment-text-info");
        textInfoEl.createEl("h4", { text: comment.selectedText, cls: "sidenote-selected-text" });
        textInfoEl.createEl("small", { text: new Date(comment.timestamp).toLocaleString(), cls: "sidenote-timestamp" });

        const actionsEl = headerEl.createDiv("sidenote-comment-actions");

        commentEl.onclick = async () => {
            // First, try to navigate via Lineage if the file is open in a lineage view
            const lineageNavigated = await this.plugin.tryNavigateToLineageNode(comment);
            if (lineageNavigated) return;

            // Fall back to standard Markdown view navigation
            let targetLeaf: WorkspaceLeaf | null = null;
            this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
                if (leaf.view instanceof MarkdownView && leaf.view.file?.path === comment.filePath) {
                    targetLeaf = leaf;
                    return false;
                }
            });

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

                editor.setSelection(
                    { line: comment.startLine, ch: comment.startChar },
                    { line: comment.endLine, ch: comment.endChar }
                );
                editor.scrollIntoView({
                    from: { line: comment.startLine, ch: 0 },
                    to: { line: comment.endLine, ch: 0 }
                }, true);
                editor.focus();
            } else {
                new Notice("Failed to jump to Markdown view.");
            }
        };

        const contentWrapper = commentEl.createDiv({ cls: "sidenote-comment-content" });
        MarkdownRenderer.renderMarkdown(
            comment.comment || "",
            contentWrapper,
            comment.filePath,
            this.plugin
        );

        contentWrapper.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            const link = target?.closest('a.internal-link') as HTMLElement | null;
            if (!link) return;

            event.preventDefault();
            event.stopPropagation();

            const href = link.getAttribute('href') || link.getAttribute('data-href') || link.innerText;
            if (href) {
                this.app.workspace.openLinkText(href, comment.filePath, false);
            }
        });

        const menuButton = actionsEl.createEl("button", { text: "...", cls: "sidenote-menu-button" });
        const menuContainer = actionsEl.createDiv("sidenote-action-menu");

        const editOption = menuContainer.createEl("button", { text: "Edit", cls: "sidenote-menu-option sidenote-menu-edit" });
        editOption.onclick = (e) => {
            e.stopPropagation();
            menuContainer.classList.remove("visible");
            new CommentModal(this.app, async (editedComment) => {
                await this.plugin.editComment(comment.id, editedComment);
            }, comment.comment).open();
        };

        const deleteOption = menuContainer.createEl("button", { text: "Delete", cls: "sidenote-menu-option sidenote-menu-delete" });
        deleteOption.onclick = (e) => {
            e.stopPropagation();
            menuContainer.classList.remove("visible");
            new ConfirmDeleteModal(this.app, () => {
                this.plugin.deleteComment(comment.id);
            }).open();
        };

        const resolveOption = menuContainer.createEl("button", {
            text: comment.resolved ? "Reopen" : "Resolve",
            cls: "sidenote-menu-option sidenote-menu-resolve"
        });
        resolveOption.onclick = (e) => {
            e.stopPropagation();
            menuContainer.classList.remove("visible");
            if (comment.resolved) {
                this.plugin.unresolveComment(comment.id);
            } else {
                this.plugin.resolveComment(comment.id);
            }
        };

        menuButton.onclick = (e) => {
            e.stopPropagation();
            menuContainer.classList.toggle("visible");
        };

        document.addEventListener("click", () => {
            menuContainer.classList.remove("visible");
        });
    }

    public renderComments() { // Made public for settings tab to re-render
        this.containerEl.empty();
        this.containerEl.addClass("sidenote-view-container");

        const viewHeader = this.containerEl.createDiv("sidenote-view-header");
        const toggleBtn = viewHeader.createEl("button", {
            text: this.showAllNotes ? "Current File" : "All Notes",
            cls: "sidenote-view-toggle",
        });
        toggleBtn.onclick = () => {
            this.showAllNotes = !this.showAllNotes;
            this.renderComments();
        };

        if (this.showAllNotes) {
            this.renderAllNotesView();
            return;
        }

        if (this.file) {
            let commentsForFile = this.plugin.commentManager.getCommentsForFile(this.file.path);

            if (!this.plugin.settings.showResolvedComments) {
                commentsForFile = commentsForFile.filter(c => !c.resolved);
            }

            if (this.plugin.settings.commentSortOrder === "position") {
                commentsForFile.sort((a, b) => {
                    if (a.startLine === b.startLine) {
                        return a.startChar - b.startChar;
                    }
                    return a.startLine - b.startLine;
                });
            } else {
                commentsForFile.sort((a, b) => a.timestamp - b.timestamp);
            }

            if (commentsForFile.length > 0) {
                const commentsContainer = this.containerEl.createDiv("sidenote-comments-container");
                commentsForFile.forEach((comment) => {
                    this.renderCommentItem(commentsContainer, comment);
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

    private renderAllNotesView() {
        let allComments = this.plugin.commentManager.getComments();

        if (!this.plugin.settings.showResolvedComments) {
            allComments = allComments.filter(c => !c.resolved);
        }

        if (allComments.length === 0) {
            const emptyStateEl = this.containerEl.createDiv("sidenote-empty-state");
            emptyStateEl.createEl("p", { text: "No comments found across all notes." });
            return;
        }

        // Group by filePath
        const byFile = new Map<string, typeof allComments>();
        for (const comment of allComments) {
            const group = byFile.get(comment.filePath) ?? [];
            group.push(comment);
            byFile.set(comment.filePath, group);
        }

        const commentsContainer = this.containerEl.createDiv("sidenote-comments-container");
        for (const [filePath, comments] of byFile) {
            const fileName = filePath.split("/").pop() ?? filePath;
            const fileSection = commentsContainer.createDiv("sidenote-file-section");
            fileSection.createEl("h3", { text: fileName, cls: "sidenote-file-heading" });

            const sorted = [...comments];
            if (this.plugin.settings.commentSortOrder === "position") {
                sorted.sort((a, b) => a.startLine !== b.startLine ? a.startLine - b.startLine : a.startChar - b.startChar);
            } else {
                sorted.sort((a, b) => a.timestamp - b.timestamp);
            }

            for (const comment of sorted) {
                this.renderCommentItem(fileSection, comment);
            }
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

class ConfirmDeleteModal extends Modal {
    onConfirm: () => void;

    constructor(app: App, onConfirm: () => void) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("sidenote-confirm-modal");

        contentEl.createEl("h2", { text: "Delete comment" });
        contentEl.createEl("p", { text: "Are you sure you want to delete this comment? This action cannot be undone." });

        const footer = contentEl.createDiv("sidenote-modal-footer");

        const cancelButton = footer.createEl("button", {
            text: "Cancel",
            cls: "sidenote-modal-cancel-btn"
        });
        cancelButton.onclick = () => {
            this.close();
        };

        const deleteButton = footer.createEl("button", {
            text: "Delete",
            cls: "mod-warning sidenote-modal-submit-btn"
        });
        deleteButton.onclick = () => {
            this.onConfirm();
            this.close();
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class CommentModal extends Modal {
    comment: string;
    onSubmit: (comment: string) => void | Promise<void>;
    initialComment: string;
    private textareaEl: HTMLTextAreaElement | null = null;
    private submitButtonEl: HTMLButtonElement | null = null;
    private cancelButtonEl: HTMLButtonElement | null = null;
    private readonly submitGuard = new SubmitExecutionGuard(400);

    constructor(app: App, onSubmit: (comment: string) => void | Promise<void>, initialComment: string = '') {
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
        input.classList.add("sidenote-textarea");
        this.textareaEl = input;

        // Add keyboard event handlers
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            // Cmd/Ctrl + Enter to save (for desktop/laptop users)
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void this.submitComment();
            }
            // Esc to cancel
            if (e.key === 'Escape') {
                e.preventDefault();
                if (!this.submitGuard.isSubmitting()) {
                    this.close();
                }
            }
        });

        const footer = contentEl.createDiv("sidenote-modal-footer");
        const cancelButton = footer.createEl("button", {
            text: "Cancel",
            cls: "sidenote-modal-cancel-btn"
        });
        this.cancelButtonEl = cancelButton;

        const handleCancel = () => {
            this.close();
        };

        const submitButton = footer.createEl("button", {
            text: this.initialComment ? "Save" : "Add",
            cls: "mod-cta sidenote-modal-submit-btn"
        });
        this.submitButtonEl = submitButton;

        // Prevent focus on button
        submitButton.setAttribute('type', 'button');

        const handleSubmit = async () => {
            if (this.textareaEl) {
                this.textareaEl.blur();
            }
            await this.submitComment();
        };

        bindModalActionHandlers({
            submitButton,
            cancelButton,
            submitGuard: this.submitGuard,
            onSubmitTriggered: handleSubmit,
            onCancelTriggered: handleCancel,
        });

        // Set focus after short delay to ensure modal is fully rendered
        setTimeout(() => {
            input.focus();
            // On mobile, scroll to the textarea to ensure it's visible
            if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);

        // Click outside to close (for tablets)
        this.modalEl.addEventListener('click', (e: MouseEvent) => {
            if (e.target === this.modalEl) {
                this.close();
            }
        });

        // Prevent body scroll when modal is open on mobile
        document.body.style.overflow = 'hidden';
    }

    async submitComment() {
        if (!this.textareaEl) {
            new Notice("Error: Comment field is empty");
            return;
        }

        if (!this.submitGuard.tryStartSubmit()) {
            return;
        }

        if (this.submitButtonEl) {
            this.submitButtonEl.disabled = true;
        }
        if (this.cancelButtonEl) {
            this.cancelButtonEl.disabled = true;
        }

        this.comment = this.textareaEl.value;
        try {
            await this.onSubmit(this.comment);
            this.close();
        } catch (error) {
            new Notice("Error: Failed to save comment");
            console.error("Error in onSubmit:", error);
        } finally {
            this.submitGuard.finishSubmit();
            if (this.submitButtonEl) {
                this.submitButtonEl.disabled = false;
            }
            if (this.cancelButtonEl) {
                this.cancelButtonEl.disabled = false;
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        this.textareaEl = null;
        this.submitButtonEl = null;
        this.cancelButtonEl = null;
        this.submitGuard.reset();
        // Restore body scroll
        document.body.style.overflow = '';
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

        new Setting(containerEl)
            .setName("Show resolved comments")
            .setDesc("Display resolved comments in the sidebar (shown dimmed). Uncheck to hide resolved comments entirely.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showResolvedComments)
                    .onChange(async (value: boolean) => {
                        this.plugin.settings.showResolvedComments = value;
                        await this.plugin.saveData();
                        // Re-render the custom view if it's open to apply the new setting
                        this.app.workspace.getLeavesOfType("sidenote-view").forEach(leaf => {
                            if (leaf.view instanceof SideNoteView) {
                                leaf.view.renderComments();
                            }
                        });
                    })
            );

        new Setting(containerEl)
            .setName("Highlight color")
            .setDesc("Choose the color for highlighted comments in the editor")
            .addColorPicker((colorPicker) =>
                colorPicker
                    .setValue(this.plugin.settings.highlightColor || "#FFC800")
                    .onChange(async (value: string) => {
                        this.plugin.settings.highlightColor = value;
                        await this.plugin.saveData();
                        // Apply color changes immediately
                        this.plugin.applyHighlightColor();
                    })
            );

        new Setting(containerEl)
            .setName("Highlight opacity")
            .setDesc("Set the transparency of the highlight (0 = transparent, 1 = opaque)")
            .addSlider((slider) =>
                slider
                    .setLimits(0, 1, 0.1)
                    .setValue(this.plugin.settings.highlightOpacity || 0.2)
                    .onChange(async (value: number) => {
                        this.plugin.settings.highlightOpacity = value;
                        await this.plugin.saveData();
                        // Apply opacity changes immediately
                        this.plugin.applyHighlightColor();
                    })
            );

        new Setting(containerEl)
            .setName("Markdown comments folder")
            .setDesc("Folder (relative to vault) where sidenote markdown backup files are stored")
            .addText((text) =>
                text
                    .setPlaceholder("side-note-comments")
                    .setValue(this.plugin.settings.markdownFolder || "")
                    .onChange(async (value) => {
                        this.plugin.settings.markdownFolder = value.trim() || "side-note-comments";
                        await this.plugin.saveData();
                    })
            );

        new Setting(containerEl)
            .setName("Create Markdown Backup")
            .setDesc("Export all comments to markdown files in the configured folder")
            .addButton((button) =>
                button
                    .setButtonText("Create Backup")
                    .onClick(async () => {
                        await this.plugin.migrateInlineCommentsToMarkdown();
                        new Notice("Markdown backup created successfully!");
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
    private editorUpdateTimers: Record<string, number> = {};
    private readonly duplicateAddWindowMs = 800;
    private lastAddFingerprint: { key: string; at: number } | null = null;

    private registerFreshSettingTab(): void {
        const appWithSettings = this.app as App & {
            setting?: { pluginTabs?: Record<string, PluginSettingTab> };
        };

        const pluginTabs = appWithSettings.setting?.pluginTabs;
        if (pluginTabs && pluginTabs[this.manifest.id]) {
            delete pluginTabs[this.manifest.id];
        }

        this.addSettingTab(new SideNoteSettingTab(this.app, this));
    }

    /** Ensure markdown comment folder exists and return normalized path */
    private async ensureCommentFolder(): Promise<string> {
        const folder = this.settings.markdownFolder.trim() || DEFAULT_SETTINGS.markdownFolder;
        const normalized = folder.replace(/^\/+|\/+$/g, "");
        const exists = await this.app.vault.adapter.exists(normalized);
        if (!exists) {
            await this.app.vault.createFolder(normalized);
        }
        return normalized;
    }

    /** Build side-note file path for a given note */
    private getSideNoteFilePath(notePath: string): string {
        const folder = this.settings.markdownFolder.trim() || DEFAULT_SETTINGS.markdownFolder;
        const normalized = folder.replace(/^\/+|\/+$/g, "");
        const base = notePath.replace(/\.md$/i, "").replace(/\//g, "__");
        return `${normalized}/${base}-sidenote.md`;
    }

    /** Build markdown block with marker */
    private buildMarkdownBlock(excerpt: string, body: string, commentId: string): string {
        return buildCommentMarkdownBlock(excerpt, body, commentId);
    }

    /** Write or append comment to markdown file and return path */
    private async writeCommentToMarkdown(notePath: string, excerpt: string, body: string, commentId: string): Promise<string> {
        const folder = await this.ensureCommentFolder();
        const filePath = this.getSideNoteFilePath(notePath);
        const block = this.buildMarkdownBlock(excerpt, body, commentId);

        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            const content = await this.app.vault.read(existing);
            const updated = content.trim().length === 0 ? block : `${content}\n\n${block}`;
            await this.app.vault.modify(existing, updated);
        } else {
            const header = `# Side Notes for ${notePath}\n\n`;
            await this.app.vault.create(filePath, `${header}${block}`);
        }

        return filePath;
    }

    /** Update markdown block by id (fallback to legacy timestamp marker) */
    private async updateMarkdownComment(comment: Comment, newBody: string): Promise<void> {
        const filePath = comment.commentPath || this.getSideNoteFilePath(comment.filePath);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        const content = await this.app.vault.read(file);
        const updated = replaceMarkdownCommentBlock(content, comment, newBody);
        if (updated === content) return;
        await this.app.vault.modify(file, updated);
    }

    /** Delete markdown block by id (fallback to legacy timestamp marker) */
    private async deleteMarkdownComment(comment: Comment): Promise<void> {
        const filePath = comment.commentPath || this.getSideNoteFilePath(comment.filePath);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        const content = await this.app.vault.read(file);
        const updated = removeMarkdownCommentBlock(content, comment);
        if (updated === content) return;
        await this.app.vault.modify(file, updated);
    }

    /**
     * Try to navigate to the comment's location in a Lineage view.
     * Returns true if navigation was successful, false otherwise.
     */
    async tryNavigateToLineageNode(comment: Comment): Promise<boolean> {
        // Check if lineage plugin is loaded
        const lineagePlugin = (this.app as any).plugins?.plugins?.['lineage'];
        if (!lineagePlugin) return false;

        // Find a lineage view showing the target file
        const lineageLeaves = this.app.workspace.getLeavesOfType('lineage');
        let targetLeaf: WorkspaceLeaf | null = null;

        for (const leaf of lineageLeaves) {
            const view = leaf.view as any;
            if (view?.file?.path === comment.filePath) {
                targetLeaf = leaf;
                break;
            }
        }

        if (!targetLeaf) return false;

        const view = targetLeaf.view as any;
        const documentStore = view.documentStore;
        if (!documentStore) return false;

        // Get the document content (Record<nodeId, { content: string }>)
        const documentState = documentStore.getValue();
        const content: Record<string, { content: string }> = documentState.document.content;

        // Find the node containing the selected text
        let targetNodeId: string | null = null;
        const searchText = comment.selectedText;

        // First try exact match
        for (const [nodeId, nodeData] of Object.entries(content)) {
            if (nodeData.content.includes(searchText)) {
                targetNodeId = nodeId;
                break;
            }
        }

        // If exact match not found, try case-insensitive search
        if (!targetNodeId && searchText) {
            const lowerSearch = searchText.toLowerCase();
            for (const [nodeId, nodeData] of Object.entries(content)) {
                if (nodeData.content.toLowerCase().includes(lowerSearch)) {
                    targetNodeId = nodeId;
                    break;
                }
            }
        }

        if (!targetNodeId) return false;

        // Navigate to the node
        this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
        view.viewStore.dispatch({
            type: 'view/set-active-node/mouse',
            payload: { id: targetNodeId }
        });

        return true;
    }

    async onload() {
        await this.loadPluginData(); // Load all data

        this.commentManager = new CommentManager(this.comments);

        // Migrate existing comments: add missing hashes and initialize isOrphaned flag
        await this.migrateComments();

        // Register editor extensions for highlighting comments
        this.registerEditorExtension([this.createHighlightPlugin()]);

        // Also highlight commented text inside rendered Markdown (Live Preview/Reading view)
        this.registerMarkdownPreviewHighlights();

        this.registerFreshSettingTab();

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
            id: "view-all-comments",
            name: "View all comments",
            icon: "list",
            callback: async () => {
                await this.activateView();
                this.app.workspace.getLeavesOfType("sidenote-view").forEach(leaf => {
                    if (leaf.view instanceof SideNoteView) {
                        leaf.view.setShowAllNotes(true);
                    }
                });
            },
        });

        this.addCommand({
            id: "add-comment-to-selection",
            name: "Add comment to selection",
            icon: "message-square",
            editorCallback: async (editor, view) => {
                const selection = editor.getSelection();
                const cursorStart = editor.getCursor("from");
                const cursorEnd = editor.getCursor("to");
                const filePath = view.file?.path;

                // Validate selection exists and has content
                if (selection && selection.trim().length > 0 && filePath) {
                    new CommentModal(this.app, async (comment) => {
                        const selectedTextHash = await generateHash(selection);
                        const newComment: Comment = {
                            id: generateCommentId(),
                            filePath: filePath,
                            startLine: cursorStart.line,
                            startChar: cursorStart.ch,
                            endLine: cursorEnd.line,
                            endChar: cursorEnd.ch,
                            selectedText: selection,
                            selectedTextHash: selectedTextHash,
                            comment: comment,
                            timestamp: Date.now(),
                            isOrphaned: false,
                        };
                        await this.addComment(newComment);
                    }).open();
                } else {
                    new Notice("Please select some text to add a comment.");
                }
            },
        });

        // Add context menu item to editor
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                // Only add if selection exists
                if (editor.somethingSelected()) {
                    menu.addItem((item) => {
                        item.setTitle("Add comment to selection")
                            .setIcon("message-square")
                            .onClick(async () => {
                                const selection = editor.getSelection();
                                const cursorStart = editor.getCursor("from");
                                const cursorEnd = editor.getCursor("to");
                                const filePath = view.file?.path;

                                // Validate selection has content
                                if (selection && selection.trim().length > 0 && filePath) {
                                    new CommentModal(this.app, async (comment) => {
                                        const selectedTextHash = await generateHash(selection);
                                        const newComment: Comment = {
                                            id: generateCommentId(),
                                            filePath: filePath,
                                            startLine: cursorStart.line,
                                            startChar: cursorStart.ch,
                                            endLine: cursorEnd.line,
                                            endChar: cursorEnd.ch,
                                            selectedText: selection,
                                            selectedTextHash: selectedTextHash,
                                            comment: comment,
                                            timestamp: Date.now(),
                                            isOrphaned: false,
                                        };
                                        await this.addComment(newComment);
                                    }).open();
                                } else {
                                    new Notice("Please select some text to add a comment.");
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
                    // Refresh editor decorations for the newly active file
                    this.refreshEditorDecorations();
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

        // Update comments when files are modified (disk-level)
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                // Handle data.json updates
                if (file.path === '.obsidian/plugins/side-note/data.json' ||
                    (file instanceof TFile && file.name === 'data.json' && file.parent?.name === 'side-note')) {
                    try {
                        await this.loadPluginData();
                        await this.migrateComments();
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

        // Live editor change - refresh decorations without marking orphaned (safe for mobile)
        this.registerEvent(
            this.app.workspace.on('editor-change', (editor, info) => {
                const filePath = info?.file?.path;
                if (!filePath) return;

                const run = () => {
                    try {
                        // Only refresh decorations; coordinates are updated on file save
                        // This avoids marking comments as orphaned during active editing
                        this.refreshEditorDecorations();
                    } catch (e) {
                        console.warn('Failed to refresh decorations on editor-change', e);
                    }
                };

                // Debounce per file to avoid excessive work while typing
                if (this.editorUpdateTimers[filePath]) {
                    window.clearTimeout(this.editorUpdateTimers[filePath]);
                }
                this.editorUpdateTimers[filePath] = window.setTimeout(run, 250);
            })
        );
    }

    /**
     * Activate the Side Note view and highlight a specific comment
     */
    async activateViewAndHighlightComment(commentId: string) {
        await this.activateView();
        // Find the SideNoteView and highlight the comment
        const leaves = this.app.workspace.getLeavesOfType("sidenote-view");
        leaves.forEach(leaf => {
            if (leaf.view instanceof SideNoteView) {
                leaf.view.highlightComment(commentId);
            }
        });
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
        // Force immediate refresh of editor decorations
        this.refreshEditorDecorations();
        new Notice(message);
    }

    private createAddFingerprint(comment: Comment): string {
        return [
            comment.filePath,
            comment.startLine,
            comment.startChar,
            comment.endLine,
            comment.endChar,
            comment.selectedText,
            comment.comment,
        ].join("|");
    }

    async addComment(newComment: Comment) {
        const now = Date.now();
        const fingerprint = this.createAddFingerprint(newComment);
        if (
            this.lastAddFingerprint &&
            this.lastAddFingerprint.key === fingerprint &&
            now - this.lastAddFingerprint.at < this.duplicateAddWindowMs
        ) {
            return;
        }
        this.lastAddFingerprint = { key: fingerprint, at: now };
        this.commentManager.addComment(newComment);
        await this.onCommentsChanged("Comment added!");
    }

    async editComment(commentId: string, newCommentText: string) {
        this.commentManager.editComment(commentId, newCommentText);
        await this.onCommentsChanged("Comment updated!");
    }

    async deleteComment(commentId: string) {
        this.commentManager.deleteComment(commentId);
        await this.onCommentsChanged("Comment deleted!");
    }

    async resolveComment(commentId: string) {
        this.commentManager.resolveComment(commentId);
        await this.onCommentsChanged("Comment resolved!");
    }

    async unresolveComment(commentId: string) {
        this.commentManager.unresolveComment(commentId);
        await this.onCommentsChanged("Comment reopened!");
    }

    async loadPluginData() {
        const loadedData: PluginData = Object.assign({}, { comments: [] }, DEFAULT_SETTINGS, await this.loadData());
        this.settings = {
            commentSortOrder: loadedData.commentSortOrder || DEFAULT_SETTINGS.commentSortOrder,
            showHighlights: loadedData.showHighlights !== undefined ? loadedData.showHighlights : DEFAULT_SETTINGS.showHighlights,
            markdownFolder: loadedData.markdownFolder || DEFAULT_SETTINGS.markdownFolder,
            highlightColor: loadedData.highlightColor || DEFAULT_SETTINGS.highlightColor,
            highlightOpacity: loadedData.highlightOpacity !== undefined ? loadedData.highlightOpacity : DEFAULT_SETTINGS.highlightOpacity,
            showResolvedComments: loadedData.showResolvedComments !== undefined ? loadedData.showResolvedComments : DEFAULT_SETTINGS.showResolvedComments,
        };
        this.comments = loadedData.comments || [];
        // Apply highlight color on load
        this.applyHighlightColor();
    }

    /**
     * Migrate existing comments to add missing hashes and initialize flags
     */
    async migrateComments() {
        let needsSave = false;

        for (const comment of this.comments) {
            // Backfill missing id for legacy comments
            if (!comment.id) {
                comment.id = generateCommentId();
                needsSave = true;
            }
            // Add missing selectedTextHash
            if (!comment.selectedTextHash && comment.selectedText) {
                comment.selectedTextHash = await generateHash(comment.selectedText);
                needsSave = true;
            }
            // Initialize isOrphaned flag if not present
            if (comment.isOrphaned === undefined) {
                comment.isOrphaned = false;
                needsSave = true;
            }
        }

        if (needsSave) {
            await this.saveData();
            console.log("Migrated comments: backfilled ids/hashes and initialized flags");
        }
    }

    /**
     * Export existing inline comments to markdown files
     */
    async migrateInlineCommentsToMarkdown() {
        let changed = false;
        for (const comment of this.comments) {
            if (!comment.commentPath) {
                const path = await this.writeCommentToMarkdown(comment.filePath, comment.selectedText, comment.comment, comment.id);
                comment.commentPath = path;
                changed = true;
            }
        }
        if (changed) {
            await this.saveData();
        }
    }

    /**
     * Inject highlights into rendered Markdown (reading view only)
     * Skips Live Preview/editing modes to preserve context menu functionality.
     */
    private registerMarkdownPreviewHighlights() {
        this.registerMarkdownPostProcessor((element, context) => {
            // Only apply to Reading view (non-editing preview)
            // Live Preview editing mode preserves context menu through editor decorations
            const previewContainer = element.closest('.markdown-preview-view');
            if (!previewContainer) {
                return; // Not in Reading view, skip
            }

            if (!this.settings.showHighlights) return;

            const comments = this.commentManager
                .getCommentsForFile(context.sourcePath)
                .filter(c => !c.isOrphaned && !!c.selectedText);

            if (!comments.length) return;

            // Collect all text nodes with absolute offsets
            const textNodes: Array<{ node: Text; start: number; end: number }> = [];
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let offset = 0;

            while (walker.nextNode()) {
                const node = walker.currentNode as Text;
                const value = node.nodeValue || "";
                if (!value.length) continue;
                const start = offset;
                const end = start + value.length;
                textNodes.push({ node, start, end });
                offset = end;
            }

            const fullText = textNodes.map(t => t.node.nodeValue || "").join("");
            if (!fullText.length) return;

            const wraps: Array<{ start: number; end: number; comment: Comment }> = [];

            for (const comment of comments) {
                const target = comment.selectedText;
                if (!target) continue;
                const idx = fullText.indexOf(target);
                if (idx === -1) continue;
                wraps.push({
                    start: idx,
                    end: idx + target.length,
                    comment,
                });
            }

            if (!wraps.length) return;

            // Helper to map absolute offset to text node and relative position
            const findPos = (absolute: number): { node: Text; offsetInNode: number } | null => {
                for (const entry of textNodes) {
                    if (absolute >= entry.start && absolute <= entry.end) {
                        return { node: entry.node, offsetInNode: absolute - entry.start };
                    }
                }
                return null;
            };

            // Apply from the end to avoid offset shifts as we wrap
            wraps.sort((a, b) => b.start - a.start);

            for (const wrap of wraps) {
                const startPos = findPos(wrap.start);
                const endPos = findPos(wrap.end);
                if (!startPos || !endPos) continue;

                try {
                    const range = document.createRange();
                    range.setStart(startPos.node, startPos.offsetInNode);
                    range.setEnd(endPos.node, endPos.offsetInNode);

                    const span = document.createElement('span');
                    span.classList.add('sidenote-highlight', 'sidenote-highlight-preview');
                    span.dataset.commentId = wrap.comment.id;
                    span.addEventListener('click', (event: MouseEvent) => {
                        // Only handle primary button clicks; let other interactions (context menu, selections) flow
                        if (event.button !== 0) return;
                        void this.activateViewAndHighlightComment(wrap.comment.id);
                    });

                    // Ensure browser/Obsidian context menus still work on right-click
                    span.addEventListener('contextmenu', () => {
                        /* intentionally empty to keep default behavior */
                    });

                    range.surroundContents(span);
                } catch (e) {
                    // If the range crosses invalid boundaries, skip this wrap
                    console.warn('Failed to wrap preview highlight', e);
                    continue;
                }
            }
        });
    }

    /**
     * Apply highlight color settings by updating CSS variables
     */
    applyHighlightColor() {
        const root = document.documentElement;
        const color = this.settings.highlightColor;
        const opacity = this.settings.highlightOpacity;

        // Convert hex to RGB
        const rgb = this.hexToRgb(color);
        const rgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
        const rgbaHoverColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(opacity + 0.15, 1)})`; // Darker on hover
        const rgbaBorderColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(opacity + 0.4, 1)})`; // Darker for border
        const rgbaOrphaned = `rgba(255, 100, 100, ${opacity})`; // Red tone for orphaned
        const rgbaOrphanedHover = `rgba(255, 100, 100, ${Math.min(opacity + 0.15, 1)})`; // Darker on hover
        const rgbaOrphanedBorder = `rgba(255, 100, 100, ${Math.min(opacity + 0.35, 1)})`; // Darker for orphaned border

        // Set CSS variables
        root.style.setProperty('--sidenote-highlight-color', rgbaColor);
        root.style.setProperty('--sidenote-highlight-hover', rgbaHoverColor);
        root.style.setProperty('--sidenote-highlight-border', rgbaBorderColor);
        root.style.setProperty('--sidenote-orphaned-color', rgbaOrphaned);
        root.style.setProperty('--sidenote-orphaned-hover', rgbaOrphanedHover);
        root.style.setProperty('--sidenote-orphaned-border', rgbaOrphanedBorder);

        // Refresh editor decorations to apply new colors
        this.refreshEditorDecorations();
    }

    /**
     * Convert hex color to RGB object
     */
    hexToRgb(hex: string): { r: number; g: number; b: number } {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 200, b: 0 }; // Default to yellow if invalid
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
                // Force editor to refresh by dispatching the force update effect
                if (editor && (editor as any).cm) {
                    const cm = (editor as any).cm;
                    if (cm.dispatch) {
                        cm.dispatch({ effects: [forceUpdateEffect.of(null)] });
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
            view: EditorView;

            constructor(view: EditorView) {
                this.view = view;
                this.decorations = this.buildDecorations(view);

                // Add click event listener to handle highlight clicks
                this.view.dom.addEventListener('click', this.handleClick.bind(this));
            }

            destroy() {
                // Clean up event listener
                this.view.dom.removeEventListener('click', this.handleClick.bind(this));
            }

            handleClick(event: MouseEvent) {
                const target = event.target as HTMLElement;
                // Check if clicked on a highlight
                const highlight = target.closest('.sidenote-highlight');
                if (highlight) {
                    const commentId = highlight.getAttribute('data-comment-id');
                    if (commentId) {
                        // Open sidebar if not open and highlight the comment
                        plugin.activateViewAndHighlightComment(commentId);
                    }
                }
            }

            update(update: ViewUpdate) {
                // Rebuild decorations if document changed, viewport changed, or force update effect is present
                if (update.docChanged || update.viewportChanged || update.transactions.some(tr => tr.effects.some(e => e.is(forceUpdateEffect)))) {
                    this.decorations = this.buildDecorations(update.view);
                }
            }

            buildDecorations(view: EditorView): DecorationSet {
                const builder = new RangeSetBuilder<Decoration>();

                // Check if highlights are enabled
                if (!plugin.settings.showHighlights) {
                    return builder.finish();
                }

                // Get the file associated with this specific EditorView
                let filePath: string | null = null;
                plugin.app.workspace.iterateAllLeaves((leaf) => {
                    if (leaf.view instanceof MarkdownView && leaf.view.file) {
                        const editor = leaf.view.editor;
                        if (editor && (editor as any).cm === view) {
                            filePath = leaf.view.file.path;
                        }
                    }
                });

                if (!filePath) return builder.finish();

                const doc = view.state.doc;
                const decorationsArray: Array<{from: number, to: number, decoration: Decoration}> = [];

                const comments = plugin.commentManager.getCommentsForFile(filePath);

                comments.forEach(comment => {
                    // Skip resolved comments (don't show highlights for resolved items)
                    if (comment.resolved) {
                        return;
                    }

                    try {
                        // Always search for the text in the current document to find accurate position
                        // This ensures highlights stay correct even during active editing on mobile
                        const docText = doc.toString();
                        let highlightFound = false;

                        if (!comment.isOrphaned && comment.selectedText) {
                            // Try to find the comment text in the current document
                            const idx = docText.indexOf(comment.selectedText);
                            if (idx !== -1) {
                                // Found the text - highlight it
                                const from = idx;
                                const to = idx + comment.selectedText.length;
                                if (from >= 0 && to <= doc.length && from < to) {
                                    decorationsArray.push({
                                        from,
                                        to,
                                        decoration: Decoration.mark({
                                            class: 'sidenote-highlight',
                                            attributes: {
                                                'data-comment-id': comment.id
                                            }
                                        })
                                    });
                                    highlightFound = true;
                                }
                            }
                        }

                        // If exact text not found and comment has hash, try hash-based search
                        if (!highlightFound && comment.selectedTextHash && !comment.isOrphaned) {
                            const lines = docText.split('\n');
                            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                                const line = lines[lineNum];
                                for (let startChar = 0; startChar < line.length; startChar++) {
                                    const candidate = line.substring(startChar, startChar + comment.selectedText.length);
                                    if (candidate.length === comment.selectedText.length) {
                                        // Simple hash check using existing hash function
                                        let hash = 0;
                                        for (let i = 0; i < candidate.length; i++) {
                                            hash = ((hash << 5) - hash) + candidate.charCodeAt(i);
                                        }
                                        if (Math.abs(hash).toString(16) === comment.selectedTextHash.substring(0, 8)) {
                                            // Approximate hash match found
                                            try {
                                                const line_obj = doc.line(lineNum + 1);
                                                const from = line_obj.from + startChar;
                                                const to = from + comment.selectedText.length;
                                                if (from >= 0 && to <= doc.length && from < to) {
                                                    decorationsArray.push({
                                                        from,
                                                        to,
                                                        decoration: Decoration.mark({
                                                            class: 'sidenote-highlight',
                                                            attributes: {
                                                                'data-comment-id': comment.id
                                                            }
                                                        })
                                                    });
                                                    highlightFound = true;
                                                    break;
                                                }
                                            } catch (e) {
                                                // Line doesn't exist, skip
                                            }
                                        }
                                    }
                                }
                                if (highlightFound) break;
                            }
                        }

                        // Fallback: use stored coordinates if text not found
                        if (!highlightFound && !comment.isOrphaned) {
                            try {
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
                                                'data-comment-id': comment.id
                                            }
                                        })
                                    });
                                }
                            } catch (e) {
                                // Line doesn't exist, skip
                            }
                        }

                        // For orphaned comments, highlight one character after the original position
                        if (comment.isOrphaned) {
                            try {
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
                                                'data-comment-id': comment.id
                                            }
                                        })
                                    });
                                }
                            } catch (e) {
                                // Line doesn't exist, skip
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
