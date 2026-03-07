import * as vscode from 'vscode'
import { basename, dirname } from 'node:path'
import { getWorktrees, getWorktreeCommonDir } from '../utils/git.js'
import { debounce } from '../utils/debounce.js'
import { clearDisposables } from '../utils/disposables.js'
import { normalizeWorktreePath, tryNormalizePath } from '../utils/path.js'

/**
 * @import { Worktree } from '../utils/git.js'
 * @import { DisposableLike } from '../utils/disposables.types.js'
 */

/**
 * @typedef { (worktreeItem: WorktreeItem, isOpen: boolean) => void } OnDidChangeOpenStatus
 */

/** @implements { vscode.TreeDataProvider<RepoItem | WorktreeItem> } */
export class WorktreeProvider {
	/**
	 * key: normalized repository's common-dir
	 * @type { Map<string, RepoItem> }
	 * @readonly
	 */
	#repos = new Map()
	/**
	 * key: workspace folder uri's string representation
	 * @type { Map<string, RepoItem | AbortController> }
	 * @readonly
	 */
	#rootFolders = new Map()
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
				this.#restart()
			} else if (element.contextValue === 'repository') {
				await element.refreshWorktrees()
				this.notify(element)
			}
		},
		300,
		{ eager: true }
	)

	constructor() {
		this.#restart()

		let pendingPromises = 0
		function onSettled() {
			if (--pendingPromises === 0) syncWorktreesState()
		}
		const syncWorktreesState = debounce(() => {
			const normalizedFolders = getNormalizedWorkspaceFolders()
			for (const repo of this.#repos.values()) {
				if (repo.rootFolders.size === 0) {
					repo.dispose()
					this.#repos.delete(repo.id)
				} else if (normalizedFolders) {
					for (const worktree of repo.worktrees) {
						worktree.syncOpenStatus(normalizedFolders)
					}
				}
			}
			this.notify()
		}, 200)
		
		this.#disposables.push(
			this.#repos,
			this.#changeTreeDataEmitter,
			syncWorktreesState,
			vscode.workspace.onDidChangeWorkspaceFolders(async ({ added, removed }) => {
				syncWorktreesState.dispose()
				for (const folder of removed) {
					const folderId = folder.uri.toString()
					const value = this.#rootFolders.get(folderId)
					if (value) {
						this.#rootFolders.delete(folderId)
						if (value instanceof AbortController) {
							value.abort()
						} else {
							value.rootFolders.delete(folderId)
						}
					}
				}
				this.#handleAddedFolders(added).finally((pendingPromises++, onSettled))
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
			const workspaceRepos = new Set()
			const { workspaceFolders } = vscode.workspace
			if (workspaceFolders) {
				for (const { uri } of workspaceFolders) {
					const repo = this.#rootFolders.get(uri.toString())
					if (repo instanceof RepoItem) {
						workspaceRepos.add(repo)
					}
				}
			}
			return Array.from(workspaceRepos)
		} else if (element.contextValue === 'repository') {
			return element.worktrees
		}
	}

	dispose() {
		this.#rootFolders.clear()
		clearDisposables(this.#disposables)
	}

	async #restart() {
		this.#rootFolders.clear()
		clearDisposables(this.#repos)
		await this.#handleAddedFolders()
		this.notify()
	}

	/** @param { readonly vscode.WorkspaceFolder[] | undefined } workspaceFolders */
	async #handleAddedFolders(workspaceFolders = vscode.workspace.workspaceFolders) {
		if (!workspaceFolders) return
		return Promise.all(workspaceFolders.map(async folder => {
			const { uri } = folder
			const folderId = uri.toString()
			const controller = new AbortController()
			this.#rootFolders.set(folderId, controller)
			try {
				const commonDir = await getWorktreeCommonDir(uri.fsPath, { signal: controller.signal })
				if (commonDir) {
					const repoId = normalizeWorktreePath(commonDir)
					let repo = this.#repos.get(repoId)
					if (!repo) {
						repo = new RepoItem(this, repoId, commonDir, controller)
						this.#repos.set(repoId, repo)
					}
					repo.rootFolders.add(folderId)
					this.#rootFolders.set(folderId, repo)
					await repo.initialize
				} else {
					this.#rootFolders.delete(folderId)
				}
			} catch(error) {
				if (!(error instanceof DOMException) || error.name !== 'AbortError') {
					throw error
				}
			}
		}))
	}
}

export class RepoItem extends vscode.TreeItem {
	#watchers
	#controller
	
	/**
	 * uri string representations of workspace folders
	 * @type { Set<string> }
	 * @readonly
	 */
	rootFolders = new Set()

	/**
	 * @param { WorktreeProvider } provider
	 * @param { string } repoId
	 * @param { string } commonDir
	 * @param { AbortController } controller 
	 */
	constructor(provider, repoId, commonDir, controller) {
		super('', vscode.TreeItemCollapsibleState.Expanded)

		/** @readonly */
		this.contextValue = /** @type { const } */('repository')
		/** @readonly */
		this.id = repoId

		/** @type { [WorktreeItem<true>, ...WorktreeItem<false>[]] } */
		this.worktrees; // oxlint-disable-line
		/** @readonly @type { string } */
		this.mainPath; // oxlint-disable-line
		/** @readonly @type { Promise<undefined> } */
		this.initialize; // oxlint-disable-line

		this.iconPath = new vscode.ThemeIcon('repo')
		this.#controller = controller

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

		this.#watchers = [headWatcher, worktreeWatcher]

		const init = async () => {
			try {
				await this.refreshWorktrees(commonDir, { signal: controller.signal })

				const [{ description: path, branch }] = this.worktrees

				const mainBasename = basename(path)
				this.label = mainBasename.toLowerCase() === branch?.toLowerCase()
					? basename(dirname(path))
					: mainBasename

				Object.defineProperty(this, 'mainPath', { value: path })
			} catch(error) {
				if (!(error instanceof DOMException) || error.name !== 'AbortError') {
					throw error
				}
			}
		}

		Object.defineProperty(this, 'initialize', {
			value: new Promise((resolve, reject) => {
				try {
					resolve(init())
				} catch(error) {
					reject(error)
				}
			})
		})
	}

	/**
	 * @param { string } worktreePath
	 * @param { object } [options]
	 * @param { AbortSignal } [options.signal]
	 */
	async refreshWorktrees(worktreePath = this.mainPath, options) {
		const worktrees = await getWorktrees(worktreePath, options)
		// @ts-expect-error
		this.worktrees = worktrees.map(w => new WorktreeItem(this, w))
		const normalizedFolders = getNormalizedWorkspaceFolders()
		if (normalizedFolders) {
			for (const worktree of this.worktrees) {
				worktree.syncOpenStatus(normalizedFolders)
			}
		}
	}

	dispose() {
		this.#controller.abort()
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
		/** @readonly */
		this.command = {
			title: 'Open Worktree',
			command: 'workforest.openWorktree',
			arguments: [this]
		}
		
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

	/** @param { readonly string[] } workspaceFolders normalized workspace root folder paths */
	syncOpenStatus(workspaceFolders) {
		let isOpen = false
		for (const folderPath of workspaceFolders) {
			if (this.#isOpenIn(folderPath)) {
				isOpen = true
				break
			}
		}
		this.#setIsOpen(isOpen)
	}

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

/** @returns { readonly string[] | null } */
function getNormalizedWorkspaceFolders() {
	const { workspaceFolders } = vscode.workspace
	/** @type { string[] | undefined } */
	let normalizedFolders
	if (workspaceFolders) {
		normalizedFolders = []
		for (const { uri } of workspaceFolders) {
			const path = tryNormalizePath(uri)
			if (path) normalizedFolders.push(path)
		}
	}
	return normalizedFolders?.length ? normalizedFolders : null
}