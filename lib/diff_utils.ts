// diff_utils.ts

import { Diff, diffChars } from "npm:diff";

/**
 * Computes the difference between two strings.
 * @param stableText - The stable text to compare against.
 * @param newText - The new text to compare.
 * @returns An array of differences between the stable text and the new text.
 */
export function computeDiff(stableText: string, newText: string): Diff[] {
    return diffChars(stableText, newText);
}

/**
 * Applies the differences to generate a structured representation.
 * @param stableText - The stable text.
 * @param diffs - The list of differences.
 * @returns An array of diff objects representing added, removed, and unchanged text.
 */
export function applyDiffsToStructuredFormat(
    stableText: string,
    diffs: Diff[],
): { type: string; value: string }[] {
    return diffs.map((diff) => {
        if (diff.added) {
            return { type: "added", value: diff.value };
        } else if (diff.removed) {
            return { type: "removed", value: diff.value };
        } else {
            return { type: "unchanged", value: diff.value };
        }
    });
}

/**
 * Computes the inline diff representation for the transcription.
 * @param stableText - The current stable transcription.
 * @param newText - The incoming new text.
 * @returns The structured representation of the diff between stableText and newText.
 */
export function computeInlineDiffStructured(
    stableText: string,
    newText: string,
): { type: string; value: string }[] {
    const diffs = computeDiff(stableText, newText);
    return applyDiffsToStructuredFormat(stableText, diffs);
}

export default {
    computeDiff,
    applyDiffsToStructuredFormat,
    computeInlineDiffStructured,
};
