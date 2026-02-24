import * as vscode from 'vscode'
import { isAbsolute, resolve } from 'node:path'
import { worktreeProvider } from "./WorktreeProvider.js"
import { runGit, isValidRef } from '../utils/git.js'

/**
 * @import { RepoItem, WorktreeItem } from './WorktreeProvider.js'
 */

export function refreshWorktrees() {
	worktreeProvider.refresh()
}

/** @param { WorktreeItem } worktreeItem */
export function openWorktreeInNewWindow(worktreeItem) {
	vscode.commands.executeCommand(
		"vscode.openFolder",
		vscode.Uri.file(worktreeItem.id),
		{ forceNewWindow: true }
	)
}

/** @param { WorktreeItem } worktreeItem */
export function revealWorktreeInFileExplorer(worktreeItem) {
	vscode.commands.executeCommand(
		"revealFileInOS", 
		vscode.Uri.file(worktreeItem.id)
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
		worktreeProvider.refresh()
	}
}

/** @param { WorktreeItem } worktreeItem */
export async function removeWorktree(worktreeItem) {
	const selection = await vscode.window.showWarningMessage(`Remove Worktree (${worktreeItem.$repo.label})`, {
		modal: true,
		detail: `Remove worktree at ${worktreeItem.id}`
	}, "Remove", "Force Remove")

	if (selection) {
		const args = ['worktree', 'remove']
		if (selection === 'Force Remove') args.push('--force')
		args.push(worktreeItem.id)
		await runGit(worktreeItem.$repo.mainPath, args)
		worktreeProvider.refresh()
	}
}