import * as vscode from 'vscode'
import { normalizeWorktreePath, tryNormalizePath } from '../utils/path.js'

const STORAGE_PREFIX = 'workforest.worktreeTabs:'

/**
 * @typedef {{
 *   uri: string,
 *   isPinned: boolean,
 *   isPreview: boolean
 * }} SerializedTab
 *
 * @typedef {{
 *   viewColumn: number,
 *   isActive: boolean,
 *   activeTabIndex: number,
 *   tabs: SerializedTab[]
 * }} SerializedGroup
 *
 * @typedef {{
 *   size?: number,
 *   groups?: EditorLayoutGroup[]
 * }} EditorLayoutGroup
 *
 * @typedef {{
 *   orientation: 0 | 1,
 *   groups: EditorLayoutGroup[]
 * }} EditorLayout
 *
 * @typedef {{
 *   version: 1,
 *   layout?: EditorLayout,
 *   groups: SerializedGroup[]
 * }} TabSnapshot
 */

/**
 * Persists, restores, and closes per-worktree editor tab state across multi-root
 * workspace folder swaps.
 */
export class WorktreeTabs {
	#workspaceState

	/** @param { vscode.Memento } workspaceState */
	constructor(workspaceState) {
		this.#workspaceState = workspaceState
	}

	/**
	 * @param { vscode.Uri } worktreeUri
	 * @returns { vscode.Tab[] } dirty text tabs inside the given worktree folder
	 */
	getWorktreeDirtyFiles(worktreeUri) {
		return this.#tabsInFolder(worktreeUri).filter(t => t.isDirty)
	}

	/**
	 * Capture and persist the current tab state for `folderUri`, awaiting the write
	 * so it survives a potential window reload from folder-0 swaps.
	 * @param { vscode.Uri } folderUri
	 */
	async snapshotAndFlush(folderUri) {
		const snapshot = await this.#buildSnapshot(folderUri)
		await this.#setSnapshot(folderUri, snapshot.groups.length > 0 ? snapshot : undefined)
	}

	/**
	 * Close all text tabs inside `folderUri`. Caller must ensure dirty tabs are
	 * already saved or reverted (see {@link revertDirtyIn}).
	 * @param { vscode.Uri } folderUri
	 */
	async closeTabsIn(folderUri) {
		const tabs = this.#tabsInFolder(folderUri)
		if (tabs.length === 0) return
		await vscode.window.tabGroups.close(tabs)
	}

	/**
	 * Revert dirty text tabs inside `folderUri`, discarding unsaved changes.
	 * Used by the "Discard & Swap" path so the subsequent close doesn't prompt.
	 * @param { vscode.Uri } folderUri
	 */
	async revertDirtyIn(folderUri) {
		const dirty = this.#tabsInFolder(folderUri).filter(t => t.isDirty)
		if (dirty.length === 0) return
		for (const tab of dirty) {
			const input = tab.input
			if (!(input instanceof vscode.TabInputText)) continue
			try {
				await vscode.window.showTextDocument(input.uri, {
					viewColumn: tab.group.viewColumn,
					preserveFocus: false
				})
				await vscode.commands.executeCommand('workbench.action.revertSelectedEditor')
			} catch {
				// best-effort; if revert fails, the close step will surface a prompt
			}
		}
	}

	/**
	 * Save dirty text tabs inside `folderUri` (folder-scoped; does NOT touch dirty
	 * files elsewhere in the workspace).
	 * @param { vscode.Uri } folderUri
	 */
	async saveDirtyIn(folderUri) {
		const dirty = this.#tabsInFolder(folderUri).filter(t => t.isDirty)
		for (const tab of dirty) {
			const input = tab.input
			if (!(input instanceof vscode.TabInputText)) continue
			try {
				const doc = await vscode.workspace.openTextDocument(input.uri)
				await doc.save()
			} catch {
				// best-effort; user can resolve manually via VSCode's own save UI
			}
		}
	}

	/**
	 * Drop any cached snapshot for `folderUri` without restoring it. Used to clean
	 * up state when a folder is plainly removed from the workspace.
	 * @param { vscode.Uri } folderUri
	 */
	async deleteSnapshot(folderUri) {
		await this.#setSnapshot(folderUri, undefined)
	}

	/**
	 * Restore the saved tabs (if any) for `folderUri`. Idempotent — deletes the
	 * snapshot after a successful restore.
	 * @param { vscode.Uri } folderUri
	 */
	async restore(folderUri) {
		const snapshot = this.getSnapshot(folderUri)
		if (!snapshot || snapshot.groups.length === 0) return

		const stealFocus = vscode.window.activeTextEditor === undefined
		/** @type { string[] } */
		const missed = []

		await this.#reconcileLayout(snapshot)

		for (const group of snapshot.groups) {
			for (const tab of group.tabs) {
				try {
					await vscode.window.showTextDocument(vscode.Uri.parse(tab.uri), {
						viewColumn: group.viewColumn,
						preview: tab.isPreview,
						preserveFocus: true
					})
					if (tab.isPinned) {
						try {
							await vscode.commands.executeCommand('workbench.action.pinEditor')
						} catch {
							// pinning is best-effort
						}
					}
				} catch {
					missed.push(tab.uri)
				}
			}
		}

		if (stealFocus) {
			const activeGroup =
				snapshot.groups.find(g => g.isActive && g.activeTabIndex >= 0)
				?? snapshot.groups.find(g => g.activeTabIndex >= 0)
			if (activeGroup) {
				const activeTab = activeGroup.tabs[activeGroup.activeTabIndex]
				if (activeTab) {
					try {
						await vscode.window.showTextDocument(vscode.Uri.parse(activeTab.uri), {
							viewColumn: activeGroup.viewColumn,
							preview: activeTab.isPreview,
							preserveFocus: false
						})
					} catch {
						// active tab may have been in the missed list
					}
				}
			}
		}

		await this.#setSnapshot(folderUri, undefined)

		if (missed.length > 0) {
			const word = missed.length === 1 ? 'tab' : 'tabs'
			vscode.window.setStatusBarMessage(
				`Workforest: ${missed.length} saved ${word} no longer exist`,
				4000
			)
		}
	}

	/**
	 * Read the persisted snapshot for `folderUri`, if any.
	 * @param { vscode.Uri } folderUri
	 * @returns { TabSnapshot | undefined }
	 */
	getSnapshot(folderUri) {
		return this.#workspaceState.get(this.#keyFor(folderUri))
	}

	dispose() {
		// no listeners owned
	}

	/**
	 * @param { vscode.Uri } folderUri
	 * @param { TabSnapshot | undefined } snapshot
	 */
	#setSnapshot(folderUri, snapshot) {
		return Promise.resolve(this.#workspaceState.update(this.#keyFor(folderUri), snapshot))
	}

	/** @param { vscode.Uri } folderUri */
	#keyFor(folderUri) {
		return STORAGE_PREFIX + normalizeWorktreePath(folderUri.fsPath)
	}

	/**
	 * Text tabs whose URI is inside `folderUri`. Uses `getWorkspaceFolder` first
	 * (accurate while the folder is still in the workspace), falls back to
	 * case-normalized path-prefix matching (needed after the folder is removed).
	 * @param { vscode.Uri } folderUri
	 */
	#tabsInFolder(folderUri) {
		const folderUriStr = folderUri.toString()
		const folderPath = tryNormalizePath(folderUri)
		/** @type { vscode.Tab[] } */
		const result = []
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				const input = tab.input
				if (!(input instanceof vscode.TabInputText)) continue
				const tabUri = input.uri
				const containingFolder = vscode.workspace.getWorkspaceFolder(tabUri)
				if (containingFolder && containingFolder.uri.toString() === folderUriStr) {
					result.push(tab)
					continue
				}
				if (folderPath) {
					const tabPath = tryNormalizePath(tabUri)
					if (tabPath && isPathInside(tabPath, folderPath)) {
						result.push(tab)
					}
				}
			}
		}
		return result
	}

	/** @param { vscode.Uri } folderUri */
	async #buildSnapshot(folderUri) {
		const include = new Set(this.#tabsInFolder(folderUri))

		/** @type { EditorLayout | undefined } */
		let layout
		try {
			layout = /** @type { EditorLayout | undefined } */ (
				await vscode.commands.executeCommand('vscode.getEditorLayout')
			)
		} catch {
			layout = undefined
		}

		/** @type { SerializedGroup[] } */
		const groups = []
		for (const group of vscode.window.tabGroups.all) {
			/** @type { SerializedTab[] } */
			const tabs = []
			let activeTabIndex = -1
			for (const tab of group.tabs) {
				if (!include.has(tab)) continue
				const input = /** @type { vscode.TabInputText } */ (tab.input)
				if (tab === group.activeTab) {
					activeTabIndex = tabs.length
				}
				tabs.push({
					uri: input.uri.toString(),
					isPinned: tab.isPinned,
					isPreview: tab.isPreview
				})
			}
			if (tabs.length > 0) {
				groups.push({
					viewColumn: group.viewColumn,
					isActive: group.isActive,
					activeTabIndex,
					tabs
				})
			}
		}

		return /** @type { TabSnapshot } */ ({ version: 1, layout, groups })
	}

	/**
	 * Reconcile the editor grid before placing tabs. Three cases (see plan):
	 *  - Empty editor area → apply snapshot layout verbatim.
	 *  - Layout already matches structurally → no-op.
	 *  - Otherwise → leave the grid alone and let `showTextDocument(..., { viewColumn })`
	 *    spawn missing columns as needed. Rows that don't already exist may not be
	 *    perfectly merged (best-effort, documented limitation).
	 * @param { TabSnapshot } snapshot
	 */
	async #reconcileLayout(snapshot) {
		if (!snapshot.layout) return
		const currentGroups = vscode.window.tabGroups.all
		const firstGroup = currentGroups[0]
		const isEmpty =
			currentGroups.length === 1 &&
			firstGroup !== undefined &&
			firstGroup.tabs.length === 0
		if (isEmpty) {
			try {
				await vscode.commands.executeCommand('vscode.setEditorLayout', snapshot.layout)
			} catch {
				// fall through to column-only restoration
			}
			return
		}

		/** @type { EditorLayout | undefined } */
		let currentLayout
		try {
			currentLayout = /** @type { EditorLayout | undefined } */ (
				await vscode.commands.executeCommand('vscode.getEditorLayout')
			)
		} catch {
			currentLayout = undefined
		}
		if (currentLayout && layoutsStructurallyEqual(currentLayout, snapshot.layout)) {
			return
		}
		// Case C: leave existing groups alone; showTextDocument will create columns
		// on demand. Adding new rows non-destructively is not supported by the public
		// API and would require disturbing existing groups.
	}
}

/**
 * @param { string } child   normalized
 * @param { string } parent  normalized
 */
function isPathInside(child, parent) {
	if (child === parent) return true
	if (!child.startsWith(parent)) return false
	const lastChar = parent[parent.length - 1]
	const nextChar = child[parent.length]
	return lastChar === '/' || lastChar === '\\' || nextChar === '/' || nextChar === '\\'
}

/**
 * Structural (not size-based) equality of two editor layouts.
 * @param { EditorLayout | EditorLayoutGroup } a
 * @param { EditorLayout | EditorLayoutGroup } b
 */
function layoutsStructurallyEqual(a, b) {
	if ('orientation' in a || 'orientation' in b) {
		if (!('orientation' in a) || !('orientation' in b)) return false
		if (a.orientation !== b.orientation) return false
	}
	const aGroups = a.groups ?? []
	const bGroups = b.groups ?? []
	if (aGroups.length !== bGroups.length) return false
	for (let i = 0; i < aGroups.length; i++) {
		const ag = aGroups[i]
		const bg = bGroups[i]
		if (!ag || !bg) return false
		if (!layoutsStructurallyEqual(ag, bg)) return false
	}
	return true
}
