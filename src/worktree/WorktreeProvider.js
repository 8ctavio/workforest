import * as vscode from 'vscode'
import { basename, dirname } from 'node:path'
import { useGit, runGit, getWorktrees } from '../utils/git.js'
import { debounce } from '../utils/debounce.js'
import { clearDisposables } from '../utils/disposables.js'
import { normalizeWorktreePath, tryNormalizePath } from '../utils/path.js'

/**
 * @import { Repository } from '../dts/git.js'
 * @import { Worktree } from '../utils/git.js'
 * @import { DisposableLike } from '../utils/disposables.types.js'
 */

/**
 * @typedef { (worktreeItem: WorktreeItem, isOpen: boolean) => void } OnDidChangeOpenStatus
 */

/** @implements { vscode.TreeDataProvider<RepoItem | WorktreeItem> } */
export class WorktreeProvider {
	/**
	 * key: repository's common-dir as returned by git's CLI
	 * @type { Map<string, RepoItem> }
	 * @readonly
	 */
	#repos = new Map()
	/**
	 * key: normalized worktree path
	 * @type { Map<string, RepoItem> }
	 * @readonly
	 */
	#worktreeMainRepo = new Map()
	/** @type { Array<DisposableLike | Map<any, DisposableLike>> } */
	#disposables = []
	/** @type { vscode.EventEmitter<RepoItem | WorktreeItem | undefined | null | void> } */
	#changeTreeDataEmitter = new vscode.EventEmitter()

	onDidChangeTreeData = this.#changeTreeDataEmitter.event

	/** @param { RepoItem | WorktreeItem } [element] */
	notify = element => this.#changeTreeDataEmitter.fire(element)
	
	refresh = debounce(
		/** @param { RepoItem | WorktreeItem } [element] */
		async element => {
			if (!element) {
				await this.#restart()
				this.notify()
			} else if (element.contextValue === 'repository') {
				element.refreshWorktrees(await getWorktrees(element.mainPath))
				this.notify(element)
			}
		},
		300,
		{ eager: true }
	)

	constructor() {
		this.#restart()
		
		const git = useGit()
		const syncWorktreesOpenStatus = debounce(() => {
			this.#repos.values().forEach(repo => {
				repo.syncWorktreesOpenStatus(this.notify)
			})
		}, 200)

		this.#disposables.push(
			this.#repos,
			this.#changeTreeDataEmitter,
			syncWorktreesOpenStatus,
			vscode.workspace.onDidChangeWorkspaceFolders(syncWorktreesOpenStatus),
			git.onDidOpenRepository(this.#handleOpenedRepository, this),
			git.onDidCloseRepository(worktree => {
				const worktreePath = normalizeWorktreePath(worktree.rootUri)
				const repo = this.#worktreeMainRepo.get(worktreePath)
				if (repo) {
					this.#worktreeMainRepo.delete(worktreePath)
					if (repo.vscodeWorktrees.delete(worktreePath) && repo.vscodeWorktrees.size === 0) {
						repo.dispose()
						this.#repos.delete(repo.id)
						this.notify()
					}
				}
			})
		)
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
		this.#worktreeMainRepo.clear()
		clearDisposables(this.#disposables)
	}

	async #restart() {
		this.#worktreeMainRepo.clear()
		clearDisposables(this.#repos)

		const { repositories } = useGit()
		if (repositories.length > 0) {
			for (const repo of repositories) {
				await this.#handleOpenedRepository(repo, false)
			}
		}
	}

	/**
	 * @param { Repository } repository
	 * @param { boolean } [shouldNotify]
	 * 
	 * @TODO
	 *   - Synchronously register worktreePath to #worktreeMainRepo
	 *   - Once commonDir is available, synchronously create and register RepoItem
	 *   - Asynchronously update RepoItem's worktrees with AbortController signal support
	 */
	async #handleOpenedRepository(repository, shouldNotify = true) {
		const worktreeUri = repository.rootUri
		const { stdout: commonDir } = await runGit(worktreeUri.fsPath, [
			'rev-parse',
			'--path-format=absolute',
			'--git-common-dir'
		])

		let repo = this.#repos.get(commonDir)
		if (!repo) {
			repo = new RepoItem(this, commonDir, await getWorktrees(commonDir))
			this.#repos.set(commonDir, repo)
			if (shouldNotify) this.notify()
		}
		
		const worktreePath = normalizeWorktreePath(worktreeUri)
		repo.vscodeWorktrees.add(worktreePath)
		this.#worktreeMainRepo.set(worktreePath, repo)
	}
}

export class RepoItem extends vscode.TreeItem {
	/** @type { vscode.FileSystemWatcher[] } */
	#watchers = []
	
	/** @type { [WorktreeItem<true>, ...WorktreeItem<false>[]] } */
	// @ts-expect-error
	worktrees
	/**
	 * Normalized paths of worktrees discovered by vscode
	 * @type { Set<string> }
	 * @readonly
	 */
	vscodeWorktrees = new Set()

	/**
	 * @param { WorktreeProvider } provider
	 * @param { string } commonDir
	 * @param { Awaited<ReturnType<typeof getWorktrees>> } worktrees 
	 */
	constructor(provider, commonDir, worktrees) {
		const [mainWorktree] = worktrees
		const mainBasename = basename(mainWorktree.path)
		const label = mainBasename.toLowerCase() === mainWorktree.branch?.toLowerCase()
			? basename(dirname(mainWorktree.path))
			: mainBasename
		
		super(label, vscode.TreeItemCollapsibleState.Expanded)

		/** @readonly */
		this.contextValue = /** @type { const } */('repository')
		/** @readonly */
		this.id = commonDir
		/** @readonly */
		this.mainPath = mainWorktree.path

		this.iconPath = new vscode.ThemeIcon('repo')

		this.refreshWorktrees(worktrees)

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

	/** @param { Awaited<ReturnType<typeof getWorktrees>> } worktrees */
	refreshWorktrees(worktrees) {
		// @ts-expect-error
		this.worktrees = worktrees.map(w => new WorktreeItem(this, w))
		this.syncWorktreesOpenStatus()
 	}

	/** @param { OnDidChangeOpenStatus } [onDidChangeOpenStatus] */
	syncWorktreesOpenStatus(onDidChangeOpenStatus) {
		const { workspaceFolders } = vscode.workspace
		if (workspaceFolders) {
			const normalizedFolders = []
			for (const { uri } of workspaceFolders) {
				const path = tryNormalizePath(uri)
				if (path) normalizedFolders.push(path)
			}
			for (const worktree of this.worktrees) {
				worktree.syncOpenStatus(normalizedFolders, onDidChangeOpenStatus)
			}
		}
	}

	dispose() {
		clearDisposables(this.#watchers)
	}
}

/** @template { boolean } [T = boolean] */
export class WorktreeItem extends vscode.TreeItem {
	/** @type { undefined | boolean } */
	#isOpen
	#icons = {
		'worktree': new vscode.ThemeIcon('folder'),
		'worktree:opened': new vscode.ThemeIcon('folder-opened'),
		'main-worktree': new vscode.ThemeIcon('root-folder'),
		'main-worktree:opened': new vscode.ThemeIcon('root-folder-opened'),
	}

	/**
	 * @param { RepoItem } repo
	 * @param { Worktree<T> } worktree
	 */
	constructor(repo, worktree) {
		super(worktree.branch || basename(worktree.path))
		
		/** @readonly */
		this.contextValue = /** @type { const } */('worktree')
		/** @readonly */
		this.id = worktree.normalizedPath
		/** @readonly */
		this.description = worktree.path
		/** @readonly */
		this.tooltip = 'Open Worktree'
		/** @readonly */
		this.isMain = worktree.isMain
		/** @readonly */
		this.$repo = repo
		
		this.branch = worktree.branch
	}

	/** @param { OnDidChangeOpenStatus } [onDidChangeOpenStatus] */
	checkOpenStatus(onDidChangeOpenStatus) {
		if (vscode.workspace.workspaceFolders) {
			let isOpen = false
			for (const { uri } of vscode.workspace.workspaceFolders) {
				const folderPath = tryNormalizePath(uri)
				if (folderPath && this.#isOpenIn(folderPath)) {
					isOpen = true
					break
				}
			}
			this.#setIsOpen(isOpen, onDidChangeOpenStatus)
		}
		return this.#isOpen
	}

	/**
	 * @param { readonly string[] } workspaceFolders normalized workspace root folder paths
	 * @param { OnDidChangeOpenStatus } [onDidChangeOpenStatus]
	 */
	syncOpenStatus(workspaceFolders, onDidChangeOpenStatus) {
		let isOpen = false
		for (const folderPath of workspaceFolders) {
			if (this.#isOpenIn(folderPath)) {
				isOpen = true
				break
			}
		}
		this.#setIsOpen(isOpen, onDidChangeOpenStatus)
	}

	/** @param { boolean } isOpen */
	/**
	 * @param { boolean } isOpen 
	 * @param { OnDidChangeOpenStatus } [onDidChangeOpenStatus] 
	 */
	#setIsOpen(isOpen, onDidChangeOpenStatus) {
		if (this.#isOpen !== isOpen) {
			this.#isOpen = isOpen
			this.iconPath = this.#icons[
				this.isMain
					? isOpen
						? 'main-worktree:opened'
						: 'main-worktree'
					: isOpen
						? 'worktree:opened'
						: 'worktree'
			]
			onDidChangeOpenStatus?.(this, isOpen)
		}
	}

	/** @param { string } folderPath normalized workspace root folder path */
	#isOpenIn(folderPath) {
		const worktreePath = this.id
		if (worktreePath === folderPath) return true

		let ancestor, descendant
		if (worktreePath.length < folderPath.length) {
			ancestor = worktreePath
			descendant = folderPath
		} else {
			ancestor = folderPath
			descendant = worktreePath
		}

		if (descendant.startsWith(ancestor)) {
			const lastChar = ancestor[ancestor.length - 1]
			const nextChar = descendant[ancestor.length]
			return (
				lastChar === '/' || lastChar === '\\' ||
				nextChar === '/' || nextChar === '\\'
			)
		}

		return false
	}
}