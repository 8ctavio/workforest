import { basename, dirname } from 'node:path'
import * as vscode from 'vscode'
import { useGit, getWorktrees } from './utils/git.js'

/**
 * @import { Worktree } from './utils/git.js'
 */

export class WorktreeContainer extends vscode.TreeItem {
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
		this.contextValue = 'repository'
		this.iconPath = new vscode.ThemeIcon('repo')
		this.mainPath = mainWorktree.path
		this.worktrees = worktrees.map(w => new WorktreeItem(w, this))
	}
}

export class WorktreeItem extends vscode.TreeItem {
	/**
	 * @param { Worktree } worktree 
	 * @param { WorktreeContainer } parent 
	 */
	constructor(worktree, parent) {
		super(worktree.branch || basename(worktree.path))
		this.id = worktree.path
		this.contextValue = 'worktree'
		this.description = worktree.path
		this.iconPath = new vscode.ThemeIcon('worktree')
		this.tooltip = 'Open Worktree'
		this.$parent = parent
	}
}

/**
 * @implements { vscode.TreeDataProvider<WorktreeContainer | WorktreeItem> }
 */
export class WorktreeProvider {
	/** @type { vscode.EventEmitter<WorktreeItem | undefined | null | void> } */
	#changeTreeDataEmitter = new vscode.EventEmitter()

	onDidChangeTreeData = this.#changeTreeDataEmitter.event

	refresh() {
		this.#changeTreeDataEmitter.fire()
	}

	/** @param { WorktreeItem } element */
	getTreeItem(element) {
		return element
	}

	/** @param { WorktreeContainer | WorktreeItem } [element] */
	async getChildren(element) {
		if (!element) {
			const git = useGit()
			const { repositories } = git
	
			/** @type { Record<string, WorktreeContainer> } */
			const items = {}
			for (const repo of repositories) {
				if (repo.kind === 'repository' || repo.kind === 'worktree') {
					const worktrees = await getWorktrees(repo.rootUri.fsPath)
					const [mainWorktree] = worktrees
					items[mainWorktree.path] ??= new WorktreeContainer(worktrees)
				}
			}
			return Object.values(items)
		} else if (element instanceof WorktreeContainer) {
			return element.worktrees
		}
	}
}