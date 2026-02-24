import { isAbsolute, resolve } from 'node:path'
import * as vscode from 'vscode'
import { WorkspaceProvider } from './WorkspaceProvider.js'
import { WorktreeProvider } from './WorktreeProvider.js'
import { runGit, isValidRef, useGit } from './utils/git.js'

/**
 * @import { WorkspaceItem } from './WorkspaceProvider.js'
 * @import { WorktreeContainer, WorktreeItem } from './WorktreeProvider.js'
 */

/**
 * 
 * @param { vscode.ExtensionContext } context 
 */
export function activate(context) {
	const worktreeProvider = new WorktreeProvider()
	const workspaceProvider = new WorkspaceProvider()

	const git = useGit()
	const refreshWorktreeProvier = () => worktreeProvider.refresh()
	git.onDidOpenRepository(refreshWorktreeProvier)
	git.onDidCloseRepository(refreshWorktreeProvier)

	context.subscriptions.push(
		vscode.commands.registerCommand("workforest.refreshWorktrees", () => {
			worktreeProvider.refresh()
		}),

		vscode.commands.registerCommand("workforest.addWorktree",
			/** @param  { WorktreeContainer } worktreeContainer */
			async worktreeContainer => {
				const worktree = await vscode.window.showInputBox({
					title: `Add Worktree (${worktreeContainer.label})`,
					prompt: "Enter branch name or path for new worktree. Paths are resolved relative to the main worktree's directory."
				})
				if (worktree) {
					const { mainPath } = worktreeContainer
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
		),

		vscode.commands.registerCommand("workforest.removeWorktree",
			/** @param  { WorktreeItem } worktreeItem */
			async worktreeItem => {
				const selection = await vscode.window.showWarningMessage(`Remove Worktree (${worktreeItem.$parent.label})`, {
					modal: true,
					detail: `Remove worktree at ${worktreeItem.id}`
				}, "Remove", "Force Remove")

				if (selection) {
					const args = ['worktree', 'remove']
					if (selection === 'Force Remove') args.push('--force')
					args.push(worktreeItem.id)
					await runGit(worktreeItem.$parent.mainPath, args)
					worktreeProvider.refresh()
				}
			}
		),

		vscode.commands.registerCommand("workforest.openWorktreeInNewWindow",
			/** @param  { WorktreeItem } worktreeItem */
			worktreeItem => {
				vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(worktreeItem.id), {
					forceNewWindow: true
				})
			}
		),

		vscode.commands.registerCommand("workforest.revealWorktreeInFileExplorer",
			/** @param  { WorktreeItem } worktreeItem */
			worktreeItem => {
				vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(worktreeItem.id))
			}
		),

		vscode.commands.registerCommand("workforest.selectWorkspaceDirectory", async () => {
			const selection = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: "Select workspaces' directory"
			})
			const workspaceDir = selection?.[0]
			if (workspaceDir) {
				await vscode.workspace.getConfiguration('workforest').update(
					'workspaceDirectory',
					workspaceDir.fsPath,
					vscode.ConfigurationTarget.Global
				)
				workspaceProvider.refresh()
			}
		}),

		vscode.commands.registerCommand("workforest.refreshWorkspaceDirectory", () => {
			workspaceProvider.refresh()
		}),

		vscode.commands.registerCommand("workforest.openWorkspaceFile", 
			/** @param  { WorkspaceItem } viewItem */
			viewItem => {
				if (viewItem?.resourceUri) {
					vscode.commands.executeCommand('vscode.open', viewItem.resourceUri)
				}
			}
		),

		vscode.window.registerTreeDataProvider('worktrees', worktreeProvider),
		vscode.window.registerTreeDataProvider('workspaces', workspaceProvider)
	)
}