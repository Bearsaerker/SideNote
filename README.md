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
- **Optional Markdown Storage**: Store comments in per-note sidenote markdown files located in a configurable folder (defaults to `side-note-comments`)

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
- **Store Comments as Markdown Files**: Save comments into per-note sidenote markdown files
- **Markdown Comments Folder**: Configure the folder (relative to vault) for sidenote markdown files
- **Orphaned Comments**: View count and delete orphaned comments in bulk

## Mobile Support

**SideNote v1.0.3 and later** includes full mobile support for both iOS (Obsidian mobile app) and Android devices!

### Mobile Features

- **Responsive Design**: The comment modal automatically adapts to mobile screen sizes
- **Touch-Friendly Buttons**: All buttons have proper touch target sizes (44px minimum) for easy tapping
- **Mobile Keyboard Optimization**: Text input is optimized for mobile keyboards with 16px font size to prevent auto-zoom on iOS
- **Improved Focus Management**: Better focus handling for seamless modal interaction on touch devices
- **Text Selection Support**: Full support for selecting and commenting on text in mobile editors

### How to Add Comments on Mobile

1. Open a note in edit mode
2. **Long-press** the text you want to comment on and drag to select it
   - Start by long-pressing at the beginning of the text and drag to the end
3. Tap the **message icon (💬)** in the **editor toolbar** at the top
   - If you don't see the icon, swipe left or right on the toolbar to find it
4. Enter your comment in the modal that appears
5. Tap the **Add** button to save

### How to View Comments on Mobile

#### **Open Comments in Sidebar**

**iOS (Obsidian iOS app):**
1. Tap the hamburger menu (≡) at the top left
2. Swipe right or run the "Open in Sidebar" command
3. Comments list will appear in the sidebar

**Android (Obsidian Android app):**
1. Tap the menu icon (≡) at the top of the screen
2. Run the "Side Note: Open in Sidebar" command (search for it)
3. Comments list will appear in the right panel

#### **Open from Command Palette**

1. Tap the menu icon (≡ or ⋮) at the top of the screen
2. Open the command palette
3. Search for "side note"
4. Tap "Side Note: Open in Sidebar"
5. The sidebar will open showing all comments for the current note

### Interacting with Comments

- Tap any comment in the sidebar to jump to that location in the editor
- Tap the **edit (pencil)** icon next to a comment to edit it
- Tap the **delete (trash)** icon next to a comment to delete it

### Troubleshooting Mobile Issues

- **Message icon not visible in toolbar**: Swipe left or right on the toolbar to find it. You can customize the mobile toolbar in Obsidian's settings.
- **"Add" button not responding**: Make sure to tap the button firmly. Verify that you've entered text in the comment field (empty comments cannot be saved).
- **Text selection difficult**: Try selecting a longer text span (10+ characters) for more reliable matching.
- **Sidebar won't display**: Open the command palette from the menu (≡) at the top and run "Side Note: Open in Sidebar".

## Important Notes

### Text Tracking Limitations

**Short Text (< 10 characters)**: Comments on very short text may become unstable or jump to nearby identical text. For best results, select at least 10 characters when commenting.

**Duplicate Text**: When identical text appears multiple times, the system uses the closest match to the original position. However, extensive edits may occasionally cause comments to match the wrong instance.

### Future Enhancements

**Highlight Variations**: Plans to add customizable highlight colors and styles for different comment types.

**Richer Editing UI**: Build a richer Markdown editing experience (shortcuts/preview) on top of the new markdown storage option.

## Technical Details

- Comments are stored in `data.json` with SHA256 hashes of the selected text
- Hash-based matching ensures accurate text tracking even after file edits
- Comments marked as "orphaned" when original text is deleted (stored but inactive)
- Uses CodeMirror 6 decorations for in-editor highlighting

## Version History

### 1.0.3
- **Added full mobile support** for iOS and Android devices
- **Added comment button to mobile editor toolbar** (message icon) for easy access
- Improved comment modal with better focus management
- Added mobile-responsive CSS for touch-friendly interfaces
- Enhanced text selection validation for better error messages
- Optimized keyboard handling for mobile devices
- Increased button touch target sizes (44px) for better mobile usability
- Fixed modal scrolling and visibility issues on mobile
- Added font-size optimization (16px) to prevent iOS auto-zoom

### 1.0.2
- Added click handler on highlighted text to open sidebar and navigate to comment
- Added keyboard shortcuts to comment modal:
  - `Cmd/Ctrl + Enter` to save and close
  - `Esc` to cancel
  - Click outside modal to dismiss
- Fixed bug where highlights didn't appear immediately after adding a comment
- Added visual feedback when clicking on highlights (comment is highlighted in sidebar)
- Added optional markdown storage for comments (per-note sidenote files in configurable folder)
- Added inline→markdown migration when enabling markdown storage
- Renamed sidenote files automatically on note rename and kept references in sync
- Fixed highlight positioning when multiple editors are open for different files

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
