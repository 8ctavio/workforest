import * as vscode from 'vscode'
import { basename, dirname } from 'node:path'
import { useGit, runGit, getWorktrees } from '../utils/git.js'
import { clearDisposables } from '../utils/dispose.js'

/**
 * @import { Repository } from '../dts/git.js'
 * @import { Worktree } from '../utils/git.js'
 * @import { DisposableLike } from '../utils/dispose.types.js'
 */

/**
 * @param { RepoItem } repoItem 
 * @param { Awaited<ReturnType<typeof getWorktrees>> } worktrees 
 */
function createWorktreeItems(repoItem, worktrees) {
	return /** @type { [WorktreeItem<true>, ...WorktreeItem<false>[]] } */(
		worktrees.map(w => new WorktreeItem(repoItem, w))
	)
}

export class RepoItem extends vscode.TreeItem {
	/** @type { vscode.FileSystemWatcher[] } */
	#watchers = []

	/**
	 * @param { WorktreeProvider } provider
	 * @param { string } worktreePath
	 * @param { string } commonDir
	 * @param { Awaited<ReturnType<typeof getWorktrees>> } worktrees 
	 */
	constructor(provider, worktreePath, commonDir, worktrees) {
		const [mainWorktree] = worktrees
		const mainBasename = basename(mainWorktree.path)
		const label = mainBasename.toLowerCase() === mainWorktree.branch?.toLowerCase()
			? basename(dirname(mainWorktree.path))
			: mainBasename
		
		super(label, vscode.TreeItemCollapsibleState.Expanded)

		/** @readonly */
		this.id = `repo:${mainWorktree.path}`
		this.iconPath = new vscode.ThemeIcon('repo')
		/** @readonly */
		this.contextValue = /** @type { const } */('repository')
		/** @readonly */
		this.mainPath = mainWorktree.path
		/** @readonly */
		this.openedWorktrees = new Set(worktreePath)
		this.worktrees = createWorktreeItems(this, worktrees)

		const commonDirUri = vscode.Uri.file(commonDir)
		const headWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(commonDirUri, '{HEAD,worktrees/*/HEAD}'),
			true, false, true // ignoreCreateEvents & ignoreDeleteEvents
		)
		const worktreeWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(commonDirUri, 'worktrees/*'),
			false, true, false // ignoreChangeEvents
		)
		const refreshRepoItem = () => provider.refresh(this)
		headWatcher.onDidChange(refreshRepoItem)
		worktreeWatcher.onDidCreate(refreshRepoItem)
		worktreeWatcher.onDidDelete(refreshRepoItem)

		this.#watchers.push(headWatcher, worktreeWatcher)
	}

	dispose() {
		clearDisposables(this.#watchers)
	}
}

/** @template { boolean } [T = boolean] */
export class WorktreeItem extends vscode.TreeItem {
	/**
	 * @this { WorktreeItem }
	 * @param { RepoItem } repo
	 * @param { Worktree<T> } worktree
	 */
	constructor(repo, worktree) {
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
	/** @type { Map<string, RepoItem> } */
	#repos = new Map()
	/** @type { Map<string, string> } */
	#commonDirs = new Map()
	/** @type { Array<DisposableLike | Map<any, DisposableLike>> } */
	#disposables = []
	/** @type { vscode.EventEmitter<RepoItem | WorktreeItem | undefined | null | void> } */
	#changeTreeDataEmitter = new vscode.EventEmitter()

	onDidChangeTreeData = this.#changeTreeDataEmitter.event

	constructor() {
		const git = useGit()
		this.#disposables.push(
			this.#repos,
			this.#changeTreeDataEmitter,
			git.onDidOpenRepository(this.#handleOpenedRepository, this),
			git.onDidCloseRepository(repository => {
				const repoPath = repository.rootUri.fsPath
				const commonDir = this.#commonDirs.get(repoPath)
				if (commonDir) {
					this.#commonDirs.delete(repoPath)
					const repo = this.#repos.get(commonDir)
					if (repo?.openedWorktrees.delete(repoPath) && repo.openedWorktrees.size === 0) {
						repo.dispose()
						this.#repos.delete(commonDir)
						this.notify()
					}
				}
			})
		)
		if (git.repositories.length > 0) {
			for (const repo of git.repositories) {
				this.#handleOpenedRepository(repo, false)
			}
			this.notify()
		}
	}

	/** @param { RepoItem | WorktreeItem } [element] */
	notify(element) {
		this.#changeTreeDataEmitter.fire(element)
	}

	/** @param { RepoItem | WorktreeItem } [element] */
	async refresh(element) {
		if (element?.contextValue === 'repository') {
			element.worktrees = createWorktreeItems(element, await getWorktrees(element.mainPath))
			this.notify(element)
		}
	}

	/** @param { RepoItem | WorktreeItem } element */
	getTreeItem(element) {
		return element
	}

	/** @param { RepoItem | WorktreeItem } [element] */
	getChildren(element) {
		if (!element) {
			return this.#repos.values().toArray()
		} else if (element.contextValue === 'repository') {
			return element.worktrees
		}
	}

	dispose() {
		clearDisposables(this.#disposables)
		this.#commonDirs.clear()
	}

	/**
	 * @param { Repository } repository
	 * @param { boolean } [shouldNotify]
	 */
	async #handleOpenedRepository(repository, shouldNotify = true) {
		const repoPath = repository.rootUri.fsPath
		const { stdout: commonDir } = await runGit(repoPath, [
			'rev-parse',
			'--path-format=absolute',
			'--git-common-dir'
		])

		this.#commonDirs.set(repoPath, commonDir)
		const repo = this.#repos.get(commonDir)
		if (repo) {
			repo.openedWorktrees.add(repoPath)
		} else {
			this.#repos.set(
				commonDir,
				new RepoItem(this, repoPath, commonDir, await getWorktrees(commonDir))
			)
			if (shouldNotify) this.notify()
		}
	}
}

export const worktreeProvider = new WorktreeProvider()