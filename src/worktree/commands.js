import * as vscode from 'vscode'
import { isAbsolute, resolve } from 'node:path'
import { runGit, isValidRef, ExecutionError } from '../utils/git.js'

/**
 * @import { WorktreeProvider, RepoItem, WorktreeItem } from './WorktreeProvider.js'
 */

export function refreshGit() {
	vscode.commands.executeCommand('git.refresh')
}

/**
 * @this { WorktreeProvider }
 * @param { RepoItem } repoItem
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

/** @param { WorktreeItem } worktreeItem */
export async function removeWorktree(worktreeItem) {
	const { window } = vscode

	if (worktreeItem.isMain) {
		window.showInformationMessage("A repository's main worktree cannot be deleted.")
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
		detail: `This branch was checked out by the worktree at ${worktreeItem.description}, which was recently removed from the "${worktreeItem.$repo.label}" repository.`
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