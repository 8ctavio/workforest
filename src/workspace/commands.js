import * as vscode from 'vscode'

/**
 * @import { WorkspaceProvider, WorkspaceItem } from './WorkspaceProvider.js'
 */

/**
 * @this { WorkspaceProvider }
 */
export function refreshWorkspaceDirectory() {
	this.refresh()
}

/**
 * @this { WorkspaceProvider }
 */
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
		this.refresh()
	}
}

/** @param { WorkspaceItem } workspaceItem */
export function openWorkspaceInNewWindow(workspaceItem) {
	vscode.commands.executeCommand(
		"vscode.openFolder",
		workspaceItem.resourceUri,
		{ forceNewWindow: true }
	)
}

/** @param { WorkspaceItem } workspaceItem */
export function openWorkspaceFile(workspaceItem) {
	if (workspaceItem?.resourceUri) {
		vscode.commands.executeCommand('vscode.open', workspaceItem.resourceUri)
	}
}