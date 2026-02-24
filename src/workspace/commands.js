import * as vscode from 'vscode'
import { workspaceProvider } from "./WorkspaceProvider.js"

/**
 * @import { WorkspaceItem } from './WorkspaceProvider.js'
 */

export function refreshWorkspaceDirectory() {
	workspaceProvider.refresh()
}

export async function selectWorkspaceDirectory() {
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
}

/** @param { WorkspaceItem } workspaceItem */
export function openWorkspaceFile(workspaceItem) {
	if (workspaceItem?.resourceUri) {
		vscode.commands.executeCommand('vscode.open', workspaceItem.resourceUri)
	}
}