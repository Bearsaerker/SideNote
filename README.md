# SideNote

SideNote is a plugin for [Obsidian](https://obsidian.md) that allows you to add comments to your notes. These comments are displayed in a dedicated side pane, making it easy to review and navigate annotations without cluttering the main text. Comments are highlighted directly in the editor for quick visual reference.

## Features

### Core Features

- **Add Comment to Selection**: Easily add comments to selected text within your Markdown notes.
- **Dual View Modes**:
  - **Sidebar Mode**: Open comments in the right sidebar for persistent viewing
  - **Split View Mode**: Open comments in a split pane beside your note
- **Visual Highlights**: Commented text is automatically highlighted in the editor (yellow background with underline)
- **Auto-Tracking**: Comments automatically follow their text as you edit your notes using hash-based matching
- **Click to Navigate**:
  - Click any comment in the side pane to jump to its location in the editor
  - Click any highlighted text in the editor to open the sidebar and highlight the corresponding comment
- **Edit and Delete**: Manage your comments directly from the side pane
- **Keyboard Shortcuts**: Use `Cmd/Ctrl + Enter` to save and close the comment modal, `Esc` to cancel, or click outside the modal to dismiss
- **Flexible Sorting**: Sort comments by their position in the file or by their creation timestamp
- **Orphaned Comment Management**: When the original text is deleted, comments are marked as "orphaned" and can be managed separately

### Advanced Features

- **Hash-Based Text Tracking**: Comments use SHA256 hashes to track text accurately, even when multiple instances of the same text exist
- **3-Stage Matching Strategy**:
  1. Search near original coordinates with hash verification
  2. Search entire file by hash (finds text even if it moves significantly)
  3. Mark as orphaned if text is completely deleted
- **Proximity-Based Selection**: When duplicate text exists, the system selects the match closest to the original position
- **Active File Auto-Update**: When using sidebar mode, the comment view automatically updates as you switch between files
- **Orphaned Comment Highlighting**: Deleted text locations are marked with a single red character (can be toggled off in settings)

## How to Use

### Adding Comments

1. **Select text** in the editor (minimum 3 characters recommended, 10+ characters for best accuracy)
2. **Right-click** the selected text and choose "Add comment to selection"
   - Or use the command palette (`Cmd/Ctrl + P`) → "Side Note: Add comment to selection"
3. Enter your comment in the modal that appears
   - Press `Cmd/Ctrl + Enter` to save and close
   - Press `Esc` or click outside the modal to cancel
4. The text will be automatically highlighted in yellow with an underline

### Viewing Comments

**Option 1: Sidebar Mode**
- Click the message-square icon in the ribbon
- Or run "Side Note: Open in Sidebar" from the command palette
- The view stays in the sidebar and automatically updates as you switch files

**Option 2: Split View Mode**
- Run "Side Note: Open in Split View" from the command palette
- Opens a new pane to the right, displaying comments for the current file

### Navigating Comments

- Click any comment in the side pane to jump to its location in the editor
- Click any highlighted text in the editor to open the sidebar (if not already open) and highlight the corresponding comment
- Comments are highlighted directly in the text for easy visual reference

### Managing Comments

- **Edit**: Click the pencil icon next to any comment
- **Delete**: Click the trash icon next to any comment
- **Sort**: Change sort order in Settings → Comment sort order (by position or timestamp)

### Settings

Access settings via Settings → Side Note:

- **Comment Sort Order**: Choose between position in file or timestamp
- **Show Highlights in Editor**: Toggle visual highlights on/off
- **Orphaned Comments**: View count and delete orphaned comments in bulk

## Important Notes

### Text Tracking Limitations

**Short Text (< 10 characters)**: Comments on very short text may become unstable or jump to nearby identical text. For best results, select at least 10 characters when commenting.

**Duplicate Text**: When identical text appears multiple times, the system uses the closest match to the original position. However, extensive edits may occasionally cause comments to match the wrong instance.

### Future Enhancements

🎨 **Highlight Variations**: Plans to add customizable highlight colors and styles for different comment types.

📝 **Rich Markdown Editor**: Future versions may support storing comments as separate markdown files with full formatting capabilities (links, bold, italic, etc.), allowing for more complex and interconnected annotations. Comments would be stored in a dedicated folder with references in `data.json`.

## Technical Details

- Comments are stored in `data.json` with SHA256 hashes of the selected text
- Hash-based matching ensures accurate text tracking even after file edits
- Comments marked as "orphaned" when original text is deleted (stored but inactive)
- Uses CodeMirror 6 decorations for in-editor highlighting

## Version History

### 1.0.2
- Added click handler on highlighted text to open sidebar and navigate to comment
- Added keyboard shortcuts to comment modal:
  - `Cmd/Ctrl + Enter` to save and close
  - `Esc` to cancel
  - Click outside modal to dismiss
- Fixed bug where highlights didn't appear immediately after adding a comment
- Added visual feedback when clicking on highlights (comment is highlighted in sidebar)

### 1.0.1
- Added hash-based text tracking for robust comment anchoring
- Implemented 3-stage matching strategy (hash+proximity → full-file hash → orphaned)
- Added in-editor highlighting with CodeMirror 6 decorations
- Added orphaned comment detection and management
- Added dual view modes (Sidebar and Split View)
- Added active-leaf-change tracking for auto-update
- Comprehensive README documentation with limitation warnings

### 1.0.0
- Initial release
- Basic comment functionality
- Add, edit, and delete comments
- Side pane view for comment display

## License

This plugin is licensed under the [MIT License](LICENCE).
