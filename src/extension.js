import * as vscode from 'vscode'
import { WorkspaceProvider, WorkspaceItem } from './WorkspaceProvider.js'

/**
 * 
 * @param { vscode.ExtensionContext } context 
 */
export function activate(context) {
	const workspaceProvider = new WorkspaceProvider()

	context.subscriptions.push(
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

		vscode.window.registerTreeDataProvider('workspaces', workspaceProvider)
	)
}