import * as vscode from 'vscode'
import { isAbsolute, resolve } from 'node:path'
import { runGit, isValidRef, ExecutionError } from '../utils/git.js'
import { tryNormalizePath, clipPath } from '../utils/path.js'

/**
 * @import { WorktreeProvider, RepoItem, WorktreeItem } from './WorktreeProvider.js'
 */

/**
 * @this { WorktreeProvider }
 * @param { RepoItem } [repoItem]
 */
export function refreshWorktrees(repoItem) {
	this.refresh(repoItem)
}

/** @param { WorktreeItem } worktreeItem */
export function openWorktreeInNewWindow(worktreeItem) {
	vscode.commands.executeCommand(
		"vscode.openFolder",
		vscode.Uri.file(worktreeItem.description),
		{ forceNewWindow: true }
	)
}

/** @param { WorktreeItem } worktreeItem */
export function revealWorktreeInFileExplorer(worktreeItem) {
	vscode.commands.executeCommand(
		"revealFileInOS", 
		vscode.Uri.file(worktreeItem.description)
	)
}

/** @param { WorktreeItem } worktreeItem */
export async function openWorktree(worktreeItem) {
	const worktreeUri = vscode.Uri.file(worktreeItem.description)
	
	/** @type { { index: number, uri?: vscode.Uri, name?: string } | undefined } */
	let target = { index: 0 }
	let pushWorkspaceFolder = false
	
	const { workspaceFolders } = vscode.workspace
	if (workspaceFolders?.length) {
		/** @type { Array<vscode.WorkspaceFolder & { path: string, branch?: string }> } */
		const targets = []
		for (const folder of workspaceFolders) {
			const folderPath = tryNormalizePath(folder.uri)
			if (folderPath) {
				if (folderPath === worktreeItem.id) {
					const worktreeLabel = worktreeItem.branch
						? `with branch "${worktreeItem.branch}" checked out`
						: `at ${clipPath(worktreeItem.description)}`
					vscode.window.showInformationMessage(
						`The "${worktreeItem.$repo.label}" worktree (${worktreeLabel}) ` +
						"is already open as a root workspace folder."
					)
					return
				} else {
					for (const worktree of worktreeItem.$repo.worktrees.values()) {
						if (folderPath === worktree.id) {
							targets.push({
								...folder,
								path: worktree.description,
								branch: worktree.branch
							})
						}
					}
				}
			}
		}

		if (targets.length === 1) {
			[target] = targets
		} else if (targets.length > 1) {
			const selection = await vscode.window.showQuickPick(targets.map(worktreeFolder => ({
				label: worktreeFolder.name,
				description: worktreeFolder.path,
				detail: `$(git-branch) ${worktreeFolder.branch || 'No branch checked out'}`,
				iconPath: new vscode.ThemeIcon('root-folder-opened'),
				folder: worktreeFolder
			})), {
				title: 'Select Workspace Folder to Replace',
				prompt: `Choose which workspace folder to replace with worktree "${worktreeItem.description}"`,
				placeHolder: 'Filter Workspace Folders',
				matchOnDescription: true,
				matchOnDetail: true
			})
			target = selection?.folder
		} else {
			const selection = await vscode.window.showInformationMessage(
				"Worktrees may only replace workspace-root worktrees from the same repository; " +
				`no matching folders to replace were found for "${clipPath(worktreeItem.description)}". ` +
				"The worktree can be added as a new workspace folder instead.",
				'Add as New Workspace Folder'
			)
			if (selection) {
				const index = vscode.workspace.workspaceFolders?.length
				if (index) {
					pushWorkspaceFolder = true
					target.index = index
				}
			} else {
				target = undefined
			}
		}
	}

	if (target) {
		const { workspaceFile } = vscode.workspace
		if (pushWorkspaceFolder || workspaceFile) {
			vscode.workspace.updateWorkspaceFolders(target.index, pushWorkspaceFolder ? 0 : 1, {
				uri: worktreeUri,
				name: workspaceFile?.scheme === 'untitled'
					? worktreeItem.$repo.label + (worktreeItem.branch ? ` (${worktreeItem.branch})` : '')
					: target.name || /**@type {string}*/(worktreeItem.$repo.label)
			})
		} else {
			vscode.commands.executeCommand('vscode.openFolder', worktreeUri)
		}
	}
}

/** @param { RepoItem } repoItem */
export async function addWorktree(repoItem) {
	const worktree = await vscode.window.showInputBox({
		title: `Add Worktree (${repoItem.label})`,
		prompt: "Enter branch name or path for new worktree. Paths are resolved relative to the main worktree's directory."
	})

	if (worktree) {
		const { mainPath } = repoItem
		if (isAbsolute(worktree) || /^\.{0,2}[\\/]/.test(worktree)) {
			await runGit(mainPath, ['worktree', 'add', worktree])
		} else if (await isValidRef(mainPath, worktree)) {
			await runGit(mainPath, ['worktree', 'add',
				resolve(mainPath, `../${worktree}`),
				worktree
			])
		} else {
			await runGit(mainPath, ['worktree', 'add',
				'-b', worktree, '--guess-remote',
				resolve(mainPath, `../${worktree}`)
			])
		}
	}
}

/**
 * @this { WorktreeProvider }
 * @param { WorktreeItem } worktreeItem
 */
export async function removeWorktree(worktreeItem) {
	const { window } = vscode

	if (worktreeItem.isMain) {
		window.showInformationMessage("A repository's main worktree cannot be deleted.")
		return
	} else if (worktreeItem.checkOpenStatus(this.notify)) {
		const worktreeLabel = worktreeItem.branch
			? `with branch "${worktreeItem.branch}" checked out`
			: `at "${clipPath(worktreeItem.description)}"`
		window.showWarningMessage(
			`The "${worktreeItem.$repo.label}" worktree ${worktreeLabel} is currently open in the workspace; ` +
			'it should be closed before trying to remove it.'
		)
		return
	}

	const removeWorktree = await window.showWarningMessage(`Remove Worktree (${worktreeItem.$repo.label})`, {
		modal: true,
		detail: `Remove worktree at ${worktreeItem.description}`
	}, "Remove")
	if (!removeWorktree) return

	try {
		await runGit(worktreeItem.$repo.mainPath, ['worktree', 'remove', worktreeItem.description])
		await onWorktreeRemoved(worktreeItem)
	} catch (error) {
		if (!(error instanceof ExecutionError)) throw error

		const forceRemoveWorktree = await window.showErrorMessage(
			`[Failed to remove worktree] ${error.stderr || error.stdout}`,
			"Force Remove"
		)
		if (!forceRemoveWorktree) return

		try {
			await runGit(worktreeItem.$repo.mainPath, ['worktree', 'remove', '--force', worktreeItem.description])
			await onWorktreeRemoved(worktreeItem)
		} catch (error) {
			if (!(error instanceof ExecutionError)) throw error
			window.showErrorMessage(`[Failed to force remove worktree] ${error.stderr || error.stdout}`)
		}
	}
}

/** @param { WorktreeItem } worktreeItem */
async function onWorktreeRemoved(worktreeItem) {
	const { branch } = worktreeItem
	if (!branch) return

	const { window } = vscode
	const deleteBranch = await window.showInformationMessage(`Delete "${branch}" branch?`, {
		modal: true,
		detail:
			`This branch was checked out by the worktree at "${clipPath(worktreeItem.description)}", ` +
			`which was recently removed from the "${worktreeItem.$repo.label}" repository.`
	}, "Delete")
	if (!deleteBranch) return

	try {
		await runGit(worktreeItem.$repo.mainPath, ['branch', '-d', branch])
		window.setStatusBarMessage(`Deleted "${branch}" branch`, 3000)
	} catch (error) {
		if (!(error instanceof ExecutionError)) throw error

		const forceDeleteBranch = await window.showErrorMessage(
			`[Failed to delete branch] ${error.stderr || error.stdout}`,
			"Force Delete"
		)
		if (!forceDeleteBranch) return
		
		try {
			await runGit(worktreeItem.$repo.mainPath, ['branch', '-D', branch])
			window.setStatusBarMessage(`Force deleted "${branch}" branch`, 3000)
		} catch (error) {
			if (!(error instanceof ExecutionError)) throw error
			window.showErrorMessage(`[Failed to force delete branch] ${error.stderr || error.stdout}`)
		}
	}
}