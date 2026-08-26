import { App, HeadingCache, TFile } from "obsidian";

// ---- Lineage view dynamic types (no import from lineage plugin) ----

interface LineageDocumentStore {
    getValue(): {
        sections: {
            id_section: Record<string, string>;
            section_id: Record<string, string>;
        };
        document: {
            content: Record<string, { content: string }>;
        };
    };
}

interface LineageViewLike {
    isActive: boolean;
    file: { path: string } | null;
    documentStore: LineageDocumentStore;
}

/**
 * Cache of headings per file path to avoid repeated metadata cache calls.
 * Only non-empty results are cached to avoid stale data when metadata cache isn't ready.
 */
const headingCache: Map<string, HeadingCache[]> = new Map();

/**
 * Sort section numbers in document order: "1", "1.1", "1.2", "2", etc.
 */
function sortSectionNumbers(a: string, b: string): number {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/**
 * Find the Lineage view for a given file path.
 */
function findLineageViewForFile(app: App, filePath: string): LineageViewLike | null {
    const leaves = app.workspace.getLeavesOfType("lineage");
    for (const leaf of leaves) {
        const view = leaf.view as unknown as LineageViewLike | undefined;
        if (view && view.file?.path === filePath) {
            return view;
        }
    }
    return null;
}

/**
 * Find the parent heading for a given line number in a file.
 * The "parent heading" is the most recent heading whose line is at or before the target line.
 *
 * If the file is open in a Lineage view, uses Lineage's document store to find
 * headings (which are stored per-node, not in the metadata cache).
 *
 * @param app - The Obsidian app instance
 * @param filePath - Path to the markdown file
 * @param line - The line number (0-indexed) to find the parent heading for
 * @param selectedText - Optional: the comment's selected text, used to find the node in Lineage
 * @returns The parent HeadingCache, or null if no heading exists above the line or the file has no headings
 */
export async function findParentHeading(app: App, filePath: string, line: number, selectedText?: string): Promise<HeadingCache | null> {
    // First, check if the file is open in a Lineage view
    // Lineage stores content per-node, so metadata cache may be empty
    const lineageView = findLineageViewForFile(app, filePath);
    if (lineageView) {
        console.debug(`[headingLookup] File ${filePath} is open in Lineage view, using Lineage document store`);
        try {
            const docState = lineageView.documentStore.getValue();
            const { section_id, id_section } = docState.sections;
            const content = docState.document.content;
            const sections = Object.keys(section_id).sort(sortSectionNumbers);

            // Find the target node (the one containing the comment's text)
            let targetNodeId: string | null = null;
            if (selectedText) {
                for (const [nodeId, nodeData] of Object.entries(content)) {
                    if (nodeData.content.includes(selectedText)) {
                        targetNodeId = nodeId;
                        break;
                    }
                }
            }

            // Build list of headings in document order, tracking which section they belong to
            const headingsWithSection: Array<{ heading: HeadingCache; sectionNum: string; nodeId: string }> = [];
            for (const section of sections) {
                const nodeId = section_id[section];
                const nodeContent = content[nodeId]?.content ?? "";
                const lines = nodeContent.split("\n");

                for (const lineText of lines) {
                    const match = lineText.trim().match(/^(#{1,6})\s+(.+)$/);
                    if (match) {
                        headingsWithSection.push({
                            heading: {
                                level: match[1].length,
                                heading: match[2].trim(),
                                position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
                            },
                            sectionNum: section,
                            nodeId: nodeId,
                        });
                    }
                }
            }

            if (headingsWithSection.length === 0) {
                console.debug(`[headingLookup] Lineage: no headings found in document store`);
            } else if (targetNodeId) {
                // Find the target section number
                const targetSection = id_section[targetNodeId];
                console.debug(`[headingLookup] Lineage: target node ${targetNodeId} is section ${targetSection}`);

                if (targetSection) {
                    // Find the last heading whose section is the same as or before the target section
                    let result: HeadingCache | null = null;
                    for (const { heading, sectionNum, nodeId } of headingsWithSection) {
                        // Check if this heading's section comes before or is the same as the target
                        if (sortSectionNumbers(sectionNum, targetSection) <= 0) {
                            result = heading;
                        } else {
                            break;
                        }
                    }
                    console.debug(`[headingLookup] Lineage: found heading: ${result ? result.heading : 'null'}`);
                    return result;
                }
            }

            // Fallback: return the last heading (most recent in document order)
            const fallback = headingsWithSection[headingsWithSection.length - 1];
            console.debug(`[headingLookup] Lineage fallback: returning: ${fallback ? fallback.heading.heading : 'null'}`);
            return fallback ? fallback.heading : null;
        } catch (e) {
            console.debug(`[headingLookup] Error reading Lineage document store:`, e);
        }
    }

    // Fall back to standard metadata cache / file parsing
    const headings = await getHeadingsForFile(app, filePath);
    console.debug(`[headingLookup] findParentHeading: file=${filePath}, line=${line}, headings found=${headings?.length ?? 0}`);

    if (!headings || headings.length === 0) {
        console.debug(`[headingLookup] No headings for ${filePath}`);
        return null;
    }

    // Walk through headings to find the last one at or before the target line
    let result: HeadingCache | null = null;
    for (const heading of headings) {
        if (heading.position.start.line <= line) {
            result = heading;
        } else {
            break;
        }
    }

    console.debug(`[headingLookup] findParentHeading result: ${result ? result.heading : 'null'} (line ${result?.position.start.line})`);
    return result;
}

/**
 * Parse headings directly from file content as a fallback when metadata cache is not ready.
 * This is critical for Lineage view and other contexts where the metadata cache
 * may not have been populated yet.
 *
 * @param app - The Obsidian app instance
 * @param filePath - Path to the markdown file
 * @returns Array of HeadingCache parsed from file content
 */
export async function parseHeadingsFromFile(app: App, filePath: string): Promise<HeadingCache[]> {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
        console.debug(`[headingLookup] parseHeadingsFromFile: file not found for ${filePath}`);
        return [];
    }

    try {
        const content = await app.vault.read(file);
        const lines = content.split('\n');
        const headings: HeadingCache[] = [];

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].trim().match(/^(#{1,6})\s+(.+)$/);
            if (match) {
                headings.push({
                    level: match[1].length,
                    heading: match[2].trim(),
                    position: { start: { line: i, col: 0, offset: 0 }, end: { line: i, col: lines[i].length, offset: 0 } }
                });
            }
        }

        console.debug(`[headingLookup] parseHeadingsFromFile: found ${headings.length} headings in ${filePath}`);
        return headings;
    } catch (e) {
        console.debug(`[headingLookup] parseHeadingsFromFile: error reading ${filePath}:`, e);
        return [];
    }
}

/**
 * Get the headings for a file, using a cache to avoid repeated metadata cache calls.
 * Falls back to parsing file content if the metadata cache is not ready.
 *
 * @param app - The Obsidian app instance
 * @param filePath - Path to the markdown file
 * @returns Array of HeadingCache, or null if the file doesn't exist in the vault
 */
export async function getHeadingsForFile(app: App, filePath: string): Promise<HeadingCache[] | null> {
    // Check cache first (only non-empty results are cached)
    const cached = headingCache.get(filePath);
    if (cached) {
        return cached;
    }

    // Look up from metadata cache
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
        return null;
    }

    const fileCache = app.metadataCache.getFileCache(file);
    const headings = fileCache?.headings ?? [];
    console.debug(`[headingLookup] getHeadingsForFile: file=${filePath}, metadata headings=${headings.length}`);

    if (headings.length > 0) {
        headingCache.set(filePath, headings);
        return headings;
    }

    // Metadata cache is empty - might not be ready yet
    // Fall back to parsing file content directly
    console.debug(`[headingLookup] Metadata cache empty, falling back to file parsing for ${filePath}`);
    const parsed = await parseHeadingsFromFile(app, filePath);
    console.debug(`[headingLookup] Parsed ${parsed.length} headings from file content for ${filePath}`);
    if (parsed.length > 0) {
        headingCache.set(filePath, parsed);
        return parsed;
    }

    // Truly no headings - don't cache empty result (metadata may populate later)
    return [];
}

/**
 * Clear the heading cache for a specific file (call when file content changes).
 *
 * @param filePath - Path to the file whose cache should be cleared
 */
export function clearHeadingCache(filePath: string): void {
    headingCache.delete(filePath);
}

/**
 * Clear all cached headings (call on unload or when doing a full refresh).
 */
export function clearAllHeadingCache(): void {
    headingCache.clear();
}

/**
 * Build a display string for a heading with its level prefix.
 * e.g., level 2 → "## Understanding the Problem"
 *
 * @param heading - The HeadingCache to format
 * @returns Formatted string like "## Heading Text"
 */
export function formatHeadingWithLevel(heading: HeadingCache): string {
    const prefix = "#".repeat(heading.level);
    return `${prefix} ${heading.heading}`;
}
