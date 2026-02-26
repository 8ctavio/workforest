import * as vscode from 'vscode'
import * as wsc from './workspace/commands.js'
import * as wtc from './worktree/commands.js'
import { WorkspaceProvider } from './workspace/WorkspaceProvider.js'
import { WorktreeProvider } from './worktree/WorktreeProvider.js'

/**
 * @param { vscode.ExtensionContext } context 
 */
export function activate(context) {
	const { commands } = vscode
	const { subscriptions } = context
	const workspaceProvider = new WorkspaceProvider()
	const worktreeProvider = new WorktreeProvider()

	for (const command of /** @type {(keyof typeof wsc)[]} */(Object.keys(wsc))) {
		subscriptions.push(commands.registerCommand(`workforest.${command}`, wsc[command], workspaceProvider))
	}
	for (const command of /** @type {(keyof typeof wtc)[]} */(Object.keys(wtc))) {
		subscriptions.push(commands.registerCommand(`workforest.${command}`, wtc[command], worktreeProvider))
	}

	subscriptions.push(
		vscode.window.registerTreeDataProvider('workspaces', workspaceProvider),
		vscode.window.registerTreeDataProvider('worktrees', worktreeProvider),
		worktreeProvider
	)
}