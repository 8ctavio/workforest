import * as vscode from 'vscode'
import { basename, dirname } from 'node:path'
import { useGit, getWorktrees } from '../utils/git.js'

/**
 * @import { Worktree } from '../utils/git.js'
 */

export class RepoItem extends vscode.TreeItem {
	/**
	 * @param { Awaited<ReturnType<typeof getWorktrees>> } worktrees 
	 */
	constructor(worktrees) {
		const [mainWorktree] = worktrees
		const dirLabel = basename(mainWorktree.path)
		const label = dirLabel.toLowerCase() === mainWorktree.branch?.toLowerCase()
			? basename(dirname(mainWorktree.path))
			: dirLabel
		super(label, vscode.TreeItemCollapsibleState.Expanded)
		this.id = `repo:${mainWorktree.path}`
		/** @readonly */
		this.contextValue = /** @type { const } */('repository')
		this.iconPath = new vscode.ThemeIcon('repo')
		this.mainPath = mainWorktree.path
		this.worktrees = /** @type { [WorktreeItem<true>, ...WorktreeItem<false>[]] } */
			(worktrees.map(w => new WorktreeItem(w, this)))
	}
}
/** @template { boolean } [T = boolean] */
export class WorktreeItem extends vscode.TreeItem {
	/**
	 * @this { WorktreeItem }
	 * @param { Worktree<T> } worktree
	 * @param { RepoItem } repo 
	 */
	constructor(worktree, repo) {
		super(worktree.branch || basename(worktree.path))
		this.id = worktree.path
		/** @readonly */
		this.contextValue = /** @type { const } */('worktree')
		this.description = worktree.path
		this.iconPath = new vscode.ThemeIcon(worktree.isMain ? 'root-folder' : 'folder')
		this.tooltip = 'Open Worktree'
		this.isMain = worktree.isMain
		this.$repo = repo
	}
}

/**
 * @implements { vscode.TreeDataProvider<RepoItem | WorktreeItem> }
 */
class WorktreeProvider {
	/** @type { vscode.EventEmitter<RepoItem | WorktreeItem | undefined | null | void> } */
	#changeTreeDataEmitter = new vscode.EventEmitter()

	onDidChangeTreeData = this.#changeTreeDataEmitter.event

	refresh() {
		this.#changeTreeDataEmitter.fire()
	}

	/** @param { RepoItem | WorktreeItem } element */
	getTreeItem(element) {
		return element
	}

	/** @param { RepoItem | WorktreeItem } [element] */
	async getChildren(element) {
		if (!element) {
			/** @type { Record<string, RepoItem> } */
			const items = {}
			const { repositories } = useGit()
			for (const repo of repositories) {
				const worktrees = await getWorktrees(repo.rootUri.fsPath)
				const [mainWorktree] = worktrees
				items[mainWorktree.path] ??= new RepoItem(worktrees)
			}
			return Object.values(items)
		} else if (element.contextValue === 'repository') {
			return element.worktrees
		}
	}
}

export const worktreeProvider = new WorktreeProvider()