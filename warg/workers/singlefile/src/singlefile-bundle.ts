/**
 * SingleFile bundle - vendored from single-file-cli.
 * @see https://github.com/gildas-lormeau/single-file-cli
 *
 * The bundle exports three scripts:
 * - script: Main SingleFile capture script (sets up window.singlefile)
 * - hookScript: Pre-navigation hook for frame tracking
 * - zipScript: Optional ZIP compression support
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Importing raw JS bundle
import { script, hookScript, zipScript } from '../lib/single-file-bundle.js';

/**
 * Main SingleFile script to inject into pages.
 * After execution, window.singlefile.getPageData(options) is available.
 */
export const SINGLEFILE_SCRIPT: string = script;

/**
 * Pre-navigation hook script for frame tracking.
 * Should be injected via evaluateOnNewDocument before navigation.
 */
export const SINGLEFILE_HOOK: string = hookScript;

/**
 * ZIP compression script (optional).
 */
export const SINGLEFILE_ZIP: string = zipScript;
